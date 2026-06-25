'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useShadowStore } from '@/store/shadow-store';
import { ChatView } from '@/features/chat/ChatView';
import TasksApp from './tasks/page';

export default function HomePage() {
  const userId = useShadowStore(state => state.userId);
  const setUserId = useShadowStore(state => state.setUserId);
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // B5 (audit pre-beta): idrata lo store dalla SESSIONE server quando il cookie
  // JWT è valido ma lo store in-memory è vuoto. Zustand è senza persist: a freddo
  // (tipico in WebView mobile dopo cold restart/kill app) lo store parte vuoto, e
  // l'utente loggato cadeva sulla schermata di login. Ora l'auth deriva dalla
  // sessione e lo userId viene ripristinato senza passare dalla login.
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.id && !userId) {
      setUserId(session.user.id);
    }
  }, [status, session, userId, setUserId]);

  // Evita hydration mismatch + attende la risoluzione della sessione.
  if (!mounted || status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-400">
        <div className="text-sm">Caricamento...</div>
      </div>
    );
  }

  // Auth dalla sessione server (fonte di verità), con fallback allo store per i
  // path che impostano userId prima che la sessione si risolva (es. login appena
  // fatto). Non loggato: la home legacy gestisce login/register.
  const authed = status === 'authenticated' || !!userId;
  if (!authed) {
    return <TasksApp />;
  }

  // Loggato: la chat è la home.
  return <ChatView />;
}
