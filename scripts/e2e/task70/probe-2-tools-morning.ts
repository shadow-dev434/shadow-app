/**
 * Task 70 — probe 2: deterministico, zero LLM.
 *  - H/N9: executeTool('get_today_tasks') con 20 task in DB → data.tasks
 *    max 15, total=20, hasMore=true (prima il troncamento era invisibile e
 *    il modello dichiarava "hai 15 cose").
 *  - A/N32 (parte deterministica): selectMorningMoodEnergyForDate legge i
 *    LearningSignal mood/energy_declared di oggi dal DB reale.
 * Utente effimero collaudo68-t70-tools, pulizia in finally.
 */

import { db } from '@/lib/db';
import { executeTool } from '@/lib/chat/tools';
import { selectMorningMoodEnergyForDate } from '@/lib/evening-review/morning-mood-energy';
import { formatTodayInRome } from '@/lib/evening-review/dates';
import {
  createEphemeralUser,
  deleteEphemeralUser,
  assert,
  finish,
} from '../collaudo-68/lib';

async function main() {
  const eph = await createEphemeralUser('t70-tools');
  try {
    // ── H: 20 task planned → total/hasMore ──────────────────────────────
    await db.task.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        userId: eph.id,
        title: `T70 carico ${i + 1}`,
        status: 'planned',
        urgency: (i % 5) + 1,
        importance: 3,
        category: 'general',
      })),
    });

    const result = await executeTool('get_today_tasks', {}, eph.id);
    assert(result.kind === 'sideEffect' && result.success === true, 'H: executeTool ok', result);
    const data = (result as { data?: { tasks?: unknown[]; total?: number; hasMore?: boolean } }).data;
    assert(Array.isArray(data?.tasks), 'H: data.tasks è un array', data);
    assert((data!.tasks as unknown[]).length === 15, 'H: tasks troncati a 15', (data!.tasks as unknown[]).length);
    assert(data!.total === 20, 'H: total = 20 (conteggio VERO)', data!.total);
    assert(data!.hasMore === true, 'H: hasMore = true', data!.hasMore);

    // Con pochi task: total coerente e hasMore=false.
    await db.task.deleteMany({ where: { userId: eph.id, title: { startsWith: 'T70 carico' } } });
    await db.task.create({
      data: { userId: eph.id, title: 'T70 unico', status: 'planned', urgency: 3, importance: 3, category: 'general' },
    });
    const small = await executeTool('get_today_tasks', {}, eph.id);
    const smallData = (small as { data?: { tasks?: unknown[]; total?: number; hasMore?: boolean } }).data;
    assert(smallData!.total === 1 && smallData!.hasMore === false, 'H: 1 task -> total=1, hasMore=false', smallData);

    // ── A: segnali del mattino → default per la review ──────────────────
    const today = formatTodayInRome();
    const none = await selectMorningMoodEnergyForDate(eph.id, today);
    assert(none.morningMood === undefined && none.morningEnergy === undefined, 'A: nessun segnale -> nessun default', none);

    // set_user_mood/set_user_energy REALI (gli stessi tool del morning check-in).
    const moodRes = await executeTool('set_user_mood', { level: 4 }, eph.id);
    assert(moodRes.kind === 'sideEffect' && moodRes.success === true, 'A: set_user_mood ok', moodRes);
    const energyRes = await executeTool('set_user_energy', { level: 2 }, eph.id);
    assert(energyRes.kind === 'sideEffect' && energyRes.success === true, 'A: set_user_energy ok', energyRes);

    const morning = await selectMorningMoodEnergyForDate(eph.id, today);
    assert(morning.morningMood === 4, 'A: morningMood=4 dal segnale reale', morning);
    assert(morning.morningEnergy === 2, 'A: morningEnergy=2 dal segnale reale', morning);

    // L'ultimo segnale del giorno vince (ri-dichiarazione). Pausa breve:
    // due create nello stesso millisecondo renderebbero l'ordinamento
    // createdAt desc non deterministico.
    await new Promise((r) => setTimeout(r, 50));
    await executeTool('set_user_mood', { level: 5 }, eph.id);
    const updated = await selectMorningMoodEnergyForDate(eph.id, today);
    assert(updated.morningMood === 5, 'A: ri-dichiarazione -> vince l\'ultima (5)', updated);
  } finally {
    await deleteEphemeralUser(eph.email);
  }

  finish('task70/probe-2-tools-morning');
}

main().catch((err) => {
  console.error('[probe-2-tools-morning] ERRORE', err);
  process.exit(1);
});
