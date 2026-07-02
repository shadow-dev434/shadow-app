import { describe, it, expect } from 'vitest';
import { textClaimsWrite, isWriteToolName } from './claim-guard';

describe('textClaimsWrite', () => {
  it.each([
    'Creato ✓ "Chiamare il commercialista", scadenza venerdì.',
    'Creato con scadenza venerdì.',
    'Ho creato il task per le tasse.',
    "L'ho aggiunto alla lista di domani.",
    'È già creato. Non c\'è altro da fare su questo.',
    'Tranquillo, è già in lista.',
    'Fatto ✅',
    'Segnato ✓ energia bassa.',
    'Ho archiviato la bozza vecchia.',
    // Participio secco di conferma (forma osservata nel probe e2e).
    'Aggiunto. Ha una scadenza o è una cosa da fare quando capita?',
    'Fatto, per oggi (giovedì).',
    'Creato: scade venerdì.',
    'Segnato! Passiamo al resto.',
  ])('claim di scrittura → true: "%s"', (text) => {
    expect(textClaimsWrite(text)).toBe(true);
  });

  it.each([
    // Proposte e domande: nessun claim di esito.
    'Vuoi che lo crei io?',
    'Posso aggiungerlo alla lista, confermi?',
    'Se vuoi lo segno per domani.',
    'Ti conviene creare un task per le tasse.',
    // Descrizioni generiche.
    'Domani riparti dalla lista di oggi.',
    'La scadenza di venerdì è vicina.',
    'Quando hai fatto, dimmelo.',
    // Participio in mezzo al discorso: l'anchor di inizio riga non scatta.
    'Perfetto — quando l\'hai fatto, avvisami.',
    'Il task va creato prima di venerdì, ti va?',
  ])('nessun claim → false: "%s"', (text) => {
    expect(textClaimsWrite(text)).toBe(false);
  });

  it('null/undefined/vuoto → false', () => {
    expect(textClaimsWrite(null)).toBe(false);
    expect(textClaimsWrite(undefined)).toBe(false);
    expect(textClaimsWrite('')).toBe(false);
  });
});

describe('isWriteToolName', () => {
  it.each(['create_task', 'update_task', 'complete_task', 'archive_task', 'set_task_recurrence', 'stop_task_recurrence', 'set_user_energy'])(
    'write tool: %s',
    (name) => expect(isWriteToolName(name)).toBe(true),
  );
  it.each(['get_today_tasks', 'offer_body_double', 'offer_strict_mode'])(
    'NON write (letture/offerte): %s',
    (name) => expect(isWriteToolName(name)).toBe(false),
  );
});
