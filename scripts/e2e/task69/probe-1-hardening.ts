/**
 * Task 69 — probe 1: hardening (item H + I).
 *  - I (S2-K): base64 corrotto e body non-JSON a /api/chat/turn → 400, mai 500.
 *  - H (S2-H/N21): cookie admin emesso PRIMA di un reset password → 404 sulle
 *    guard admin/beta (prima passava: il collaudo 68 lo ha confermato a 200).
 * Riusa la coorte collaudo68-admin (viva, in ADMIN_EMAILS dev) con RIPRISTINO
 * di passwordChangedAt in finally. Utente effimero per la parte I.
 */

import { db } from '@/lib/db';
import {
  api,
  BASE_URL,
  mintCookie,
  cohortUser,
  createEphemeralUser,
  deleteEphemeralUser,
  assert,
  finish,
} from '../collaudo-68/lib';

async function main() {
  // ── I: input rotti → 400 ──────────────────────────────────────────────
  const eph = await createEphemeralUser('t69-hardening');
  try {
    const badB64 = await api('POST', '/api/chat/turn', {
      cookie: eph.cookie,
      body: {
        mode: 'general',
        userMessage: 'guarda questa foto',
        attachments: [{ kind: 'image', mediaType: 'image/png', data: 'not!!valid==' }],
      },
    });
    assert(badB64.status === 400, 'I: base64 corrotto -> 400', badB64.status);
    assert(/corrotto/i.test(badB64.text), 'I: messaggio parlante sul base64', badB64.text);

    const badLen = await api('POST', '/api/chat/turn', {
      cookie: eph.cookie,
      body: {
        mode: 'general',
        userMessage: 'x',
        attachments: [{ kind: 'image', mediaType: 'image/png', data: 'AAAAA' }],
      },
    });
    assert(badLen.status === 400, 'I: base64 length%4!=0 -> 400', badLen.status);

    const rawRes = await fetch(`${BASE_URL}/api/chat/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: eph.cookie },
      body: '{broken',
    });
    assert(rawRes.status === 400, 'I: body non-JSON -> 400 (era 500)', rawRes.status);
    const rawBody = (await rawRes.json()) as { error?: string };
    assert(rawBody.error === 'Richiesta non valida.', 'I: copy italiano del 400', rawBody);
  } finally {
    await deleteEphemeralUser(eph.email);
  }

  // ── H: sessione admin pre-reset → 404 ─────────────────────────────────
  const admin = await cohortUser('admin');
  const prev = await db.user.findUnique({
    where: { id: admin.id },
    select: { passwordChangedAt: true },
  });
  const staleCookie = await mintCookie({
    userId: admin.id,
    email: admin.email,
    tourCompleted: true,
    onboardingComplete: true,
  });
  try {
    // Sanity: col cookie fresco la guard admin risponde (200) PRIMA del reset.
    const pre = await api('GET', '/api/admin/beta/summary', { cookie: staleCookie });
    assert(pre.status === 200, 'H sanity: admin passa pre-reset', pre.status);

    // "Reset password" 60s nel futuro rispetto all'iat del cookie.
    await db.user.update({
      where: { id: admin.id },
      data: { passwordChangedAt: new Date(Date.now() + 60_000) },
    });

    const post = await api('GET', '/api/admin/beta/summary', { cookie: staleCookie });
    assert(post.status === 404, 'H: guard admin revoca il cookie pre-reset (404)', post.status);
    const postBeta = await api('PATCH', '/api/beta/assessment', {
      cookie: staleCookie,
      body: { instrument: 'asrs', answers: {} },
    });
    assert(postBeta.status === 404, 'H: guard beta revoca il cookie pre-reset (404)', postBeta.status);
  } finally {
    await db.user.update({
      where: { id: admin.id },
      data: { passwordChangedAt: prev?.passwordChangedAt ?? null },
    });
  }

  finish('task69/probe-1-hardening');
}

main().catch((err) => {
  console.error('[probe-1-hardening] ERRORE', err);
  process.exit(1);
});
