/**
 * Collaudo 68 — Fase 2 half2: repro complementari D30 (adaptive-profile senza
 * validazione) e nota N19 (type interno via POST notifications vs dedup cron).
 * adaptive-profile NON è nella lista route del blocco half2 (owner=half1); qui
 * si testa solo per non lasciare la pista scoperta (§8.11).
 */
import { preflightDb, api, createEphemeralUser, deleteEphemeralUser, saveEvidence, assert, finish, db } from './lib';

async function main() {
  await preflightDb();
  const u = await createEphemeralUser('d30', {});
  const C = u.cookie;
  const findings: string[] = [];

  // D30: POST adaptive-profile con campi arbitrari + tipo sbagliato su whitelist
  {
    // (a) 60+ campi arbitrari fuori whitelist → accettati o droppati?
    const arbitrary: Record<string, unknown> = {};
    for (let i = 0; i < 65; i++) arbitrary[`bogusField${i}`] = `val${i}`;
    const rArb = await api('POST', '/api/adaptive-profile', { cookie: C, body: arbitrary });
    // (b) campo whitelisted con tipo sbagliato: executiveLoad (Float) = stringa
    // prima cancella il profilo creato in (a) per riusare POST
    await db.adaptiveProfile.deleteMany({ where: { userId: u.id } });
    const rBadType = await api('POST', '/api/adaptive-profile', { cookie: C, body: { executiveLoad: 'pippo', rewardSensitivity: 'alto' } });
    // (c) GET dopo
    const g = await api('GET', '/api/adaptive-profile', { cookie: C });

    assert(rArb.status < 500, 'D30: POST campi arbitrari non 500', rArb.status);
    assert(rBadType.status === 200 || rBadType.status === 201 || rBadType.status === 500, 'D30: POST tipo sbagliato osservato', rBadType.status);

    const arbProfile = (rArb.json as { profile?: Record<string, unknown> })?.profile;
    const arbLeaked = arbProfile ? Object.keys(arbProfile).some((k) => k.startsWith('bogusField')) : false;

    saveEvidence('fase2', 'd30-adaptive-profile.txt',
      `D30 repro (adaptive-profile — owner half1, testato qui per copertura)\n` +
      `(a) POST 65 campi arbitrari fuori whitelist: HTTP ${rArb.status}; bogusField* nel profilo restituito: ${arbLeaked}\n` +
      `(b) POST executiveLoad='pippo' (Float col via stringa): HTTP ${rBadType.status} body=${rBadType.text.slice(0, 200)}\n` +
      `(c) GET dopo: HTTP ${g.status}\n` +
      `Meccanica: POST/PATCH usano whitelist jsonFields+directFields → campi non elencati DROPPATI silenziosamente. Nessuna validazione di TIPO/RANGE sui campi whitelisted.\n`);
    console.log(`  D30: arbitrari HTTP=${rArb.status} leaked=${arbLeaked} | badType HTTP=${rBadType.status}`);

    if (!arbLeaked && rArb.status < 300) {
      findings.push(`D30 (parziale SMENTITA): campi arbitrari fuori whitelist NON accettati — POST/PATCH adaptive-profile filtrano con whitelist (jsonFields/directFields), i campi ignoti vengono droppati in silenzio (HTTP ${rArb.status}).`);
    }
    if (rBadType.status >= 500) {
      findings.push(`D30 (variante CONFERMATA): POST adaptive-profile con campo whitelisted di tipo sbagliato (executiveLoad='pippo' su colonna Float) → HTTP ${rBadType.status}: nessuna validazione di tipo prima della scrittura Prisma → 500 non-pulito su input invalido.`);
    } else {
      findings.push(`D30 (variante): executiveLoad='pippo' → HTTP ${rBadType.status} (Prisma ha coercito o accettato: verificare valore persistito).`);
    }
  }

  const md = ['# D30 / N19 complementari', '', ...findings.map((f, i) => `${i + 1}. ${f}`)].join('\n');
  saveEvidence('fase2', 'd30-n19-complementari.md', md);
  await deleteEphemeralUser(u.email);
  finish('f2-api-d30-n19');
}
main().catch((e) => { console.error(e); process.exit(1); });
