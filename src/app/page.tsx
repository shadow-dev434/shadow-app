'use client';

import { useEffect, useState } from 'react';
import { useShadowStore } from '@/store/shadow-store';
import { ChatView } from '@/features/chat/ChatView';
import TasksApp from './tasks/page';

export default function HomePage() {
  const userId = useShadowStore(state => state.userId);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent hydration mismatch: render nothing on first server render
  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-400">
        <div className="text-sm">Caricamento...</div>
      </div>
    );
  }

  // Not logged in: fall back to the legacy home which already handles
  // auth gating (login/register screen)
  if (!userId) {
    return <TasksApp />;
  }

  // Logged in: show the chat as home
  return <ChatView />;
}