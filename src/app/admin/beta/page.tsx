// Pagina admin beta (Task 23 Fase 2). Gate server-side: la pagina non
// esiste (404) per chi non è nell'allowlist ADMIN_EMAILS.
import { getServerSession } from 'next-auth';
import { notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/beta/admin-guard';
import { AdminBetaView } from '@/features/beta/AdminBetaView';

export default async function AdminBetaPage() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) notFound();
  return <AdminBetaView />;
}
