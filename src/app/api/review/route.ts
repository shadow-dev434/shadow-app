import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/review — save a daily review
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { whatDone, whatAvoided, whatBlocked, restartFrom, mood, energyEnd, taskReviews } = body;

    const today = new Date().toISOString().split('T')[0];

    const review = await db.review.upsert({
      where: { date: today },
      update: {
        whatDone: whatDone || '',
        whatAvoided: whatAvoided || '',
        whatBlocked: whatBlocked || '',
        restartFrom: restartFrom || '',
        mood: mood ?? 3,
        energyEnd: energyEnd ?? 3,
      },
      create: {
        date: today,
        whatDone: whatDone || '',
        whatAvoided: whatAvoided || '',
        whatBlocked: whatBlocked || '',
        restartFrom: restartFrom || '',
        mood: mood ?? 3,
        energyEnd: energyEnd ?? 3,
      },
    });

    // Save task-level reviews
    if (taskReviews && Array.isArray(taskReviews)) {
      await db.reviewTask.deleteMany({ where: { reviewId: review.id } });

      for (const tr of taskReviews) {
        await db.reviewTask.create({
          data: {
            reviewId: review.id,
            taskId: tr.taskId,
            status: tr.status, // completed, avoided, blocked, partial
          },
        });
      }
    }

    // Update user patterns based on review
    await updatePatternsFromReview(review, taskReviews);

    return NextResponse.json({ review });
  } catch (error) {
    console.error('POST /api/review error:', error);
    return NextResponse.json({ error: 'Failed to save review' }, { status: 500 });
  }
}

// GET /api/review — get reviews
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const date = url.searchParams.get('date');

    if (date) {
      const review = await db.review.findUnique({
        where: { date },
        include: { tasks: { include: { task: true } } },
      });
      return NextResponse.json({ review });
    }

    // Get last 7 reviews
    const reviews = await db.review.findMany({
      orderBy: { date: 'desc' },
      take: 7,
      include: { tasks: { include: { task: true } } },
    });

    return NextResponse.json({ reviews });
  } catch (error) {
    console.error('GET /api/review error:', error);
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 });
  }
}

async function updatePatternsFromReview(
  review: { whatAvoided: string; whatBlocked: string; mood: number; energyEnd: number },
  taskReviews?: Array<{ taskId: string; status: string }>
) {
  try {
    // Get or create patterns record
    let patterns = await db.userPattern.findFirst();
    if (!patterns) {
      patterns = await db.userPattern.create({ data: {} });
    }

    const avoidedCategories = JSON.parse(patterns.avoidedCategories) as string[];
    const problematicCategories = JSON.parse(patterns.problematicCategories) as string[];

    // Update task avoidance counts based on review
    if (taskReviews) {
      for (const tr of taskReviews) {
        if (tr.status === 'avoided') {
          const task = await db.task.findUnique({ where: { id: tr.taskId } });
          if (task) {
            await db.task.update({
              where: { id: tr.taskId },
              data: {
                avoidanceCount: { increment: 1 },
                lastAvoidedAt: new Date().toISOString(),
              },
            });

            // Track category in patterns
            if (!avoidedCategories.includes(task.category)) {
              avoidedCategories.push(task.category);
            }
          }
        }
        if (tr.status === 'blocked' && tr.taskId) {
          // Will be handled below
        }
      }
    }

    // Update total counts
    const completedCount = taskReviews?.filter((tr) => tr.status === 'completed').length ?? 0;
    const avoidedCount = taskReviews?.filter((tr) => tr.status === 'avoided').length ?? 0;

    // Update streak
    const today = new Date().toISOString().split('T')[0];
    const lastActive = patterns.lastActiveDate;
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
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
