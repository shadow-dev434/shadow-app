/**
 * Pulizia dell'identità client persistita (Task 70 K/D-auth).
 *
 * localStorage['shadow-user'] è una copia legacy dell'identità usata per
 * l'idratazione ottimistica dello store: se sopravvive a un cambio di
 * account, Settings mostra un'identità DIVERSA da quella del cookie
 * (verificato al collaudo 68: cookie=tipo, Account=vergine). Ogni percorso
 * di signOut deve passare da qui; il mount di /tasks fa comunque la
 * verifica di coerenza con la sessione server (fonte di verità).
 */

export const CLIENT_IDENTITY_KEYS = [
  'shadow-user',
  'shadow-tour-completed',
  'shadow-profile-complete',
] as const;

export function clearClientIdentity(): void {
  try {
    for (const key of CLIENT_IDENTITY_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // storage inaccessibile (SSR/privacy mode): non bloccare il signout
  }
}
