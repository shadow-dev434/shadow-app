// Sink-guard consenso art.9 per gli endpoint che PERSISTONO dati di categoria
// particolare (questionari clinici ASRS/ADEXI, covariate diagnosi/farmaci nei
// feedback baseline/final). Difesa in profondità: il gate di consenso vive già
// nel middleware, ma i sink dei dati sanitari non devono mai scrivere senza un
// consenso registrato, anche se si arrivasse alla route per altra via.

import { db } from '@/lib/db';

export async function hasGivenConsent(userId: string): Promise<boolean> {
  const profile = await db.userProfile.findUnique({
    where: { userId },
    select: { consentGivenAt: true },
  });
  return profile?.consentGivenAt != null;
}
