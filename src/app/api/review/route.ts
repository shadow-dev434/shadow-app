import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { addDaysIso, formatTodayInRome } from '@/lib/evening-review/dates';

// Dominio di ReviewTask.status (colonna NOT NULL): payload fuori dominio → 400
// PRIMA di ogni scrittura. Storia (Task 62, S1-B): il vecchio flusso scriveva
// tr.status così com'era — un payload senza status upsertava la Review e poi
// falliva sul NOT NULL, lasciando una Review a metà che sopprimeva la review
// serale conversazionale per tutto il giorno (compute-signal vede Review-oggi).
const VALID_REVIEW_TASK_STATUSES = new Set(['completed', 'avoided', 'partial']);

// POST /api/review — save a daily review
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();
    const { whatDone, whatAvoided, whatBlocked, restartFrom, mood, energyEnd, taskReviews } = body;

    // Validazione integrale del payload taskReviews prima di toccare il DB.
    const taskReviewRows: Array<{ taskId: string; status: string }> = [];
    if (taskReviews !== undefined && taskReviews !== null) {
      if (!Array.isArray(taskReviews)) {
        return NextResponse.json({ error: 'taskReviews deve essere un array' }, { status: 400 });
      }
      for (const tr of taskReviews) {
        if (
          !tr ||
          typeof tr.taskId !== 'string' ||
          typeof tr.status !== 'string' ||
          !VALID_REVIEW_TASK_STATUSES.has(tr.status)
        ) {
          return NextResponse.json(
            { error: "taskReviews[].status obbligatorio: 'completed' | 'avoided' | 'partial'" },
            { status: 400 },
          );
        }
        taskReviewRows.push({ taskId: tr.taskId, status: tr.status });
      }
    }

    // Ownership: si scartano (come prima) le righe di task non dell'utente.
    let ownedRows = taskReviewRows;
    if (taskReviewRows.length > 0) {
      const owned = await db.task.findMany({
        where: { id: { in: taskReviewRows.map((r) => r.taskId) }, userId },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map((t) => t.id));
      ownedRows = taskReviewRows.filter((r) => ownedIds.has(r.taskId));
    }

    const today = formatTodayInRome();
    const reviewData = {
      whatDone: whatDone || '',
      whatAvoided: whatAvoided || '',
      whatBlocked: whatBlocked || '',
      restartFrom: restartFrom || '',
      mood: mood ?? 3,
      energyEnd: energyEnd ?? 3,
    };

    // Scrittura atomica: Review + ReviewTask insieme, così un errore non lascia
    // mai una Review orfana a sopprimere il segnale serale.
    const review = await db.$transaction(async (tx) => {
      const r = await tx.review.upsert({
        where: { userId_date: { userId, date: today } },
        update: reviewData,
        create: { userId, date: today, ...reviewData },
      });
      if (taskReviews !== undefined && taskReviews !== null) {
        await tx.reviewTask.deleteMany({ where: { reviewId: r.id } });
        if (ownedRows.length > 0) {
          await tx.reviewTask.createMany({
            data: ownedRows.map((row) => ({ reviewId: r.id, taskId: row.taskId, status: row.status })),
          });
        }
      }
      return r;
    });

    // Statistiche non critiche: fuori transazione, ha il suo try/catch interno.
    await updatePatternsFromReview(userId, review, ownedRows);

    return NextResponse.json({ review });
  } catch (error) {
    captureApiError(error, 'POST /api/review');
    return NextResponse.json({ error: 'Failed to save review' }, { status: 500 });
  }
}

// GET /api/review — get reviews
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const url = req.nextUrl;
    const date = url.searchParams.get('date');

    if (date) {
      const review = await db.review.findUnique({
        where: { userId_date: { userId, date } },
        include: { tasks: { include: { task: true } } },
      });
      return NextResponse.json({ review });
    }

    const reviews = await db.review.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 7,
      include: { tasks: { include: { task: true } } },
    });

    return NextResponse.json({ reviews });
  } catch (error) {
    captureApiError(error, 'GET /api/review');
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 });
  }
}

async function updatePatternsFromReview(
  userId: string,
  review: { whatAvoided: string; whatBlocked: string; mood: number; energyEnd: number },
  taskReviews?: Array<{ taskId: string; status: string }>
) {
  try {
    let patterns = await db.userPattern.findFirst({ where: { userId } });
    if (!patterns) {
      patterns = await db.userPattern.create({ data: { userId } });
    }

    const avoidedCategories = JSON.parse(patterns.avoidedCategories) as string[];
    const problematicCategories = JSON.parse(patterns.problematicCategories) as string[];

    if (taskReviews) {
      for (const tr of taskReviews) {
        if (tr.status === 'avoided') {
          const task = await db.task.findFirst({ where: { id: tr.taskId, userId } });
          if (task) {
            await db.task.update({
              where: { id: tr.taskId },
              data: {
                avoidanceCount: { increment: 1 },
                lastAvoidedAt: new Date().toISOString(),
              },
            });

            if (!avoidedCategories.includes(task.category)) {
              avoidedCategories.push(task.category);
            }
          }
        }
      }
    }

    const completedCount = taskReviews?.filter((tr) => tr.status === 'completed').length ?? 0;
    const avoidedCount = taskReviews?.filter((tr) => tr.status === 'avoided').length ?? 0;

    const today = formatTodayInRome();
    const lastActive = patterns.lastActiveDate;
    // DST-immune: addDaysIso opera su date pure YYYY-MM-DD (Date.UTC arithmetic),
    // nessun rischio di skip/repeat su giorni 23h/25h locali Rome.
    const yesterday = addDaysIso(today, -1);
    let streak = patterns.streakDays;
    if (lastActive === yesterday || lastActive === today) {
      if (lastActive !== today) streak += 1;
    } else {
      streak = completedCount > 0 ? 1 : 0;
    }

    await db.userPattern.update({
      where: { id: patterns.id },
      data: {
        avoidedCategories: JSON.stringify(avoidedCategories),
        problematicCategories: JSON.stringify(problematicCategories),
        totalTasksCompleted: patterns.totalTasksCompleted + completedCount,
        totalTasksAvoided: patterns.totalTasksAvoided + avoidedCount,
        averageCompletion:
          (patterns.averageCompletion * 10 + (completedCount / Math.max(1, taskReviews?.length ?? 1))) / 11,
        streakDays: streak,
        lastActiveDate: today,
      },
    });
  } catch (error) {
    console.error('Failed to update patterns:', error);
  }
}
