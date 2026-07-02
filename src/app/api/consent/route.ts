import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { captureApiError } from '@/lib/observability';

// POST /api/consent
// Registra il consenso esplicito pre-onboarding (gate art. 9). Sink di
// difesa: richiede ENTRAMBE le caselle — Termini di servizio (§2.1, art. 6)
// e dati di categoria particolare (§2.2, art. 9). Se ne manca una → 400.
//
// Niente update() lato client: il middleware rilegge consentGivenAt dal DB
// alla navigazione successiva (pattern #8.4), quindi dopo questo POST il
// gate lascia passare /onboarding.
//
// CONSENT_VERSION mappa 1:1 il file di copy
// shadow-consenso-esplicito-bozza-v0_2.md (DB ↔ archivio git allineati) e la
// costante CONSENT_COPY_VERSION di ConsentView. Alla validazione legale: bump
// coordinato a "1.0".
const CONSENT_VERSION = '0.2-draft';

export async function POST(req: NextRequest) {
  // allowWithoutConsent: e' la route con cui il consenso si DA (e si ri-da'
  // dopo una revoca) — gated sul consenso si bloccherebbe da sola.
  const { error, userId } = await requireSession(req, { allowWithoutConsent: true });
  if (error) return error;

  let body: { acceptTerms?: unknown; acceptArt9?: unknown };
  try {
    body = (await req.json()) as { acceptTerms?: unknown; acceptArt9?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Entrambe obbligatorie: nessun consenso parziale (decisione doc §2,
  // "nessun livello senza consenso").
  if (body.acceptTerms !== true || body.acceptArt9 !== true) {
    return NextResponse.json(
      {
        error:
          'Entrambi i consensi sono obbligatori: Termini di servizio e dati relativi alla salute (art. 9).',
      },
      { status: 400 },
    );
  }

  try {
    await db.userProfile.update({
      where: { userId },
      data: {
        consentGivenAt: new Date(),
        consentVersion: CONSENT_VERSION,
        consentArt9: true,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError(err, 'POST /api/consent');
    return NextResponse.json({ error: 'Salvataggio consenso fallito' }, { status: 500 });
  }
}

// DELETE /api/consent — revoca. Inverso della POST: azzera consentGivenAt e consentArt9
// (consentVersion resta come record storico). Il gate del middleware (DB re-read) rimbalza
// l'utente su /consent al primo hop di pagina, quindi la revoca ha effetto immediato.
export async function DELETE(req: NextRequest) {
  // allowWithoutConsent: la revoca deve restare idempotente anche a consenso
  // gia' assente (diritto art. 7(3), mai bloccato dal suo stesso esito).
  const { error, userId } = await requireSession(req, { allowWithoutConsent: true });
  if (error) return error;

  try {
    await db.userProfile.update({
      where: { userId },
      data: { consentGivenAt: null, consentArt9: false },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError(err, 'DELETE /api/consent');
    return NextResponse.json({ error: 'Revoca consenso fallita' }, { status: 500 });
  }
}
