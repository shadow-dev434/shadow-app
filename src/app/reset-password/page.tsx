import type { Metadata } from 'next';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Reimposta password — Shadow' };

// Pagina pubblica by-design: NON è nel matcher di src/middleware.ts (stesso
// pattern di /privacy e /terms). Ci si arriva dal link nell'email di reset,
// quindi per definizione senza sessione attiva.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  return <ResetPasswordForm token={token} />;
}
