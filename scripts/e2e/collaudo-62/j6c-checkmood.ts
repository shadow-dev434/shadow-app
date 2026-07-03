import { db } from './lib';
import { loadTriageStateFromContext } from '../../../src/lib/evening-review/triage';
async function main() {
  const t = await db.chatThread.findUnique({ where: { id: 'cmr2w6b0700gsib74gpd6gl2i' }, select: { contextJson: true, state: true } });
  const triage = loadTriageStateFromContext(t?.contextJson ?? null);
  console.log(JSON.stringify({ state: t?.state, moodIntake: triage?.moodIntake, candidates: triage?.candidateTaskIds?.length }, null, 2));
}
main().finally(() => db.$disconnect());
