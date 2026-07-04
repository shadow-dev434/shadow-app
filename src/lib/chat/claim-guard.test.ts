import { describe, it, expect } from 'vitest';
import { textClaimsWrite, isWriteToolName, honestFallbackMessage } from './claim-guard';

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

describe('textClaimsWrite — lessico review (Task 69 A, censimento collaudo 68 §A.6)', () => {
  it.each([
    // Tutte frasi PRONUNCIATE dal modello nei run del collaudo, con zero tool.
    'Il pacco alle poste lo segno fatto. A domani.',
    'Ottimo, la segno fatta.',
    'Segnato, la segno come fatta.',
    'Ok, le lampadine le segno come fatte — grazie per dirmelo',
    'Va bene, li rimando tutti a domani.',
    'Segnato, pin tolto. Il piano torna com\'era',
    'Piano bloccato. A domani.',
    'Chiuso. A domani.',
    'Già chiuso. A domani.',
    'Ok, registrato: 4-6 ore disponibili.',
    // Il raddoppio S1-1 alla lettera (J3): "stato" in mezzo sfuggiva.
    'È già stato creato nel turno precedente.',
  ])('claim review → true: "%s"', (text) => {
    expect(textClaimsWrite(text)).toBe(true);
  });

  it.each([
    // Proposte, deontici, prosa legittima della review: MAI scattare.
    'Vuoi che la segni come fatta?',
    'Possiamo rimandarla a domani, che dici?',
    'Il piano va confermato prima di chiudere.',
    'Se confermi, il piano viene bloccato.',
    'Chiusa la parentesi, torniamo alla lista.',
    'Hai registrato dei progressi enormi questa settimana.',
    'Quando l\'hai chiusa, dimmelo.',
    // Negazione onesta del retry: NON deve ri-scattare il guard.
    'Non l\'ho ancora registrata: la chiudo come fatta?',
  ])('prosa review legittima → false: "%s"', (text) => {
    expect(textClaimsWrite(text)).toBe(false);
  });
});

describe('isWriteToolName', () => {
  it.each(['create_task', 'update_task', 'complete_task', 'archive_task', 'set_task_recurrence', 'stop_task_recurrence', 'set_user_energy'])(
    'write tool: %s',
    (name) => expect(isWriteToolName(name)).toBe(true),
  );
  // Task 69 (A): tool review/morning che soddisfano un claim.
  it.each(['set_user_mood', 'set_user_time', 'commit_today_plan', 'add_candidate_to_review', 'remove_candidate_from_review', 'mark_entry_discussed', 'update_plan_preview', 'confirm_plan_preview', 'confirm_close_review', 'close_review_burnout', 'approve_decomposition'])(
    'write tool review (Task 69): %s',
    (name) => expect(isWriteToolName(name)).toBe(true),
  );
  it.each(['get_today_tasks', 'offer_body_double', 'offer_strict_mode', 'set_current_entry', 'propose_decomposition', 'mark_what_blocked_asked'])(
    'NON write (letture/offerte/navigazione/proposte): %s',
    (name) => expect(isWriteToolName(name)).toBe(false),
  );
});

describe('honestFallbackMessage (Task 69 A, S1-1)', () => {
  it('cattura: invita a rimandare il testo, nessun claim di scrittura', () => {
    const msg = honestFallbackMessage('general');
    expect(msg).toContain('non risulta salvato');
    expect(textClaimsWrite(msg)).toBe(false);
  });
  it('review: copy dedicato, nessun claim di scrittura', () => {
    const msg = honestFallbackMessage('evening_review');
    expect(msg).toContain('non sono riuscito a registrare');
    expect(textClaimsWrite(msg)).toBe(false);
  });
});
