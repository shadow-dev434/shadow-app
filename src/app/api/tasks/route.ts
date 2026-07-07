import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';
import { taskStatuses, terminalTaskStatuses } from '@/lib/types/shadow';
import { materializeRecurringWithRollover } from '@/lib/recurring/materialize';
import { formatTodayInRome } from '@/lib/evening-review/dates';
import { extractDeadline } from '@/lib/capture/date-extract';
import type { Prisma, Task } from '@prisma/client';

// Serializzazione comune GET/POST: date → ISO, il resto passa invariato.
function serializeTask(task: Task) {
  return {
    ...task,
    deadline: task.deadline ? new Date(task.deadline).toISOString() : null,
    lastAvoidedAt: task.lastAvoidedAt ? new Date(task.lastAvoidedAt).toISOString() : null,
    completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
    createdAt: new Date(task.createdAt).toISOString(),
    updatedAt: new Date(task.updatedAt).toISOString(),
  };
}

// GET /api/tasks — list all tasks, with optional filters
export async function GET(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    // Task 65 (B1/B2): il ricorrente di oggi (o l'occorrenza saltata piu'
    // recente) nasce anche senza passare dalla chat — questa GET e' il punto
    // d'ingresso comune di inbox e Today. Fail-open: un errore di
    // materializzazione non deve mai rompere la lista.
    try {
      await materializeRecurringWithRollover(userId, formatTodayInRome());
    } catch (err) {
      captureApiError(err, 'GET /api/tasks (materialize rollover)');
    }

    const url = req.nextUrl;
    const status = url.searchParams.get('status');
    const category = url.searchParams.get('category');
    const decision = url.searchParams.get('decision');

    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;
    if (category) where.category = category;
    if (decision) where.decision = decision;

    const tasks = await db.task.findMany({
      where,
      orderBy: { priorityScore: 'desc' },
    });

    return NextResponse.json({ tasks: tasks.map(serializeTask) });
  } catch (error) {
    captureApiError(error, 'GET /api/tasks');
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

// POST /api/tasks — create a new task (quick capture from inbox)
export async function POST(req: NextRequest) {
  const { error, userId } = await requireSession(req);
  if (error) return error;

  try {
    const body = await req.json();

    // Task 64 (B1, D14): senza title il create Prisma esplodeva in un 500
    // opaco. Contratto esplicito: 400 con messaggio chiaro.
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return NextResponse.json({ error: 'title obbligatorio' }, { status: 400 });
    }
    if (body.status !== undefined && !taskStatuses().includes(body.status)) {
      return NextResponse.json({ error: 'status non valido' }, { status: 400 });
    }
    // Task 72 (B2): il client puo' dichiarare solo le sorgenti di cattura
    // esterna. Whitelist, non blocklist: 'recurring' alimenta le stelle del
    // Cielo (lit-stars) e 'gmail' e' riservato all'ingest W8 — mai dal client.
    if (body.source !== undefined && body.source !== 'share' && body.source !== 'ocr') {
      return NextResponse.json({ error: 'source non valido' }, { status: 400 });
    }
    const source: 'share' | 'ocr' | undefined = body.source;
    // sourceRef ha senso solo per le catture esterne; cap difensivo 2000.
    const sourceRef =
      source && typeof body.sourceRef === 'string' ? body.sourceRef.slice(0, 2000) : '';

    // Task 72: dedup delle sole catture esterne (la quick-add manuale resta
    // libera di duplicare). share: stesso sourceRef (URL) o stesso titolo,
    // semantica del tool chat (executeCreateTask, Task 42). ocr: solo
    // sourceRef — il testo OCR integrale distingue due bollette con la stessa
    // intestazione, il titolo generico ("AVVISO DI PAGAMENTO") no.
    if (source) {
      const or: Prisma.TaskWhereInput[] = [];
      if (sourceRef) or.push({ sourceRef });
      if (source === 'share') {
        or.push({ title: { equals: body.title, mode: 'insensitive' } });
      }
      if (or.length > 0) {
        const existing = await db.task.findFirst({
          where: { userId, status: { notIn: terminalTaskStatuses() }, OR: or },
        });
        if (existing) {
          return NextResponse.json(
            { task: serializeTask(existing), alreadyExists: true },
            { status: 200 },
          );
        }
      }
    }

    // Task 72: parsing cheap della scadenza per lo share (zero LLM, mai
    // bloccante): solo candidati confident. L'OCR non passa di qui — la data
    // la sceglie l'utente nella sheet di conferma e arriva in body.deadline.
    let deadline: string | null = body.deadline ? new Date(body.deadline).toISOString() : null;
    if (source === 'share' && !deadline) {
      const parsed = extractDeadline(`${body.title} ${sourceRef}`);
      if (parsed) deadline = new Date(parsed).toISOString();
    }

    const task = await db.task.create({
      data: {
        userId,
        title: body.title,
        description: body.description || '',
        importance: body.importance ?? 3,
        urgency: body.urgency ?? 3,
        deadline,
        resistance: body.resistance ?? 3,
        size: body.size ?? 3,
        delegable: body.delegable ?? false,
        category: body.category || 'general',
        context: body.context || 'any',
        status: body.status || 'inbox',
        ...(source ? { source, sourceRef } : {}),
      },
    });

    return NextResponse.json({ task: serializeTask(task) }, { status: 201 });
  } catch (error) {
    captureApiError(error, 'POST /api/tasks');
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
