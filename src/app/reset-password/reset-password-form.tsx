'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap, Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

// Form client della pagina /reset-password (Task 28). Il token arriva dal
// server component (query string del link email). Stile allineato ad
// AuthGateView (src/app/tasks/page.tsx).
export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (password.length < 6) {
      setError('La password deve avere almeno 6 caratteri');
      return;
    }
    if (password !== confirm) {
      setError('Le password non coincidono');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setDone(true);
      } else {
        setError(data.error || 'Errore durante il reset. Riprova.');
      }
    } catch {
      setError('Errore di connessione. Riprova.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo & Brand (come AuthGateView) */}
        <div className="text-center space-y-4">
          <div className="w-20 h-20 rounded-2xl bg-amber-600 flex items-center justify-center mx-auto">
            <Zap className="w-10 h-10 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Shadow</h1>
            <p className="text-amber-500 text-sm mt-1">il tuo executive function esterno</p>
          </div>
        </div>

        {!token && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span className="text-sm text-red-400">
                Link di reset mancante o incompleto. Apri il link che hai ricevuto via email,
                oppure richiedine uno nuovo.
              </span>
            </div>
            <Button asChild variant="outline" className="w-full h-11 border-zinc-700 text-white hover:bg-zinc-800">
              <Link href="/?auth=forgot">Richiedi un nuovo link</Link>
            </Button>
          </div>
        )}

        {token && done && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-950/50 border border-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-sm text-emerald-300">
                Password aggiornata! Ora puoi accedere con la nuova password.
              </span>
            </div>
            <Button asChild className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white">
              <Link href="/?auth=login">Vai al login</Link>
            </Button>
          </div>
        )}

        {token && !done && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white">Imposta una nuova password</h2>
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span className="text-sm text-red-400">{error}</span>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-zinc-400">Nuova password</Label>
                <div className="relative mt-1">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Almeno 6 caratteri"
                    className="h-11 bg-zinc-900 border-zinc-700 text-white pr-10"
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Conferma password</Label>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Ripeti la nuova password"
                  className="mt-1 h-11 bg-zinc-900 border-zinc-700 text-white"
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  disabled={isLoading}
                />
              </div>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || !password || !confirm}
              className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Aggiornamento...
                </>
              ) : (
                'Reimposta password'
              )}
            </Button>
            <p className="text-center text-xs text-zinc-500">
              Il link di reset vale 1 ora e può essere usato una volta sola.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
