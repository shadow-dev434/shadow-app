'use client';

// App-picker nativo (Task 60 follow-up A / completa B8): permette di scegliere
// QUALI app mettere in pausa durante lo strict mode. Senza una selezione lo
// scudo nativo e' un no-op (focus-shield.ts: reason 'no-apps'), quindi questa
// card e' cio' che rende davvero utile il blocco. Solo Android: su web/iOS la
// facade dello scudo e' gia' no-op, quindi qui non renderizziamo nulla.
//
// Persistenza: PATCH /api/profile { blockedApps } (gia' supportato) -> store ->
// handleStartSession legge store.userProfile.blockedApps e lo passa allo scudo.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { isAndroid } from '@/lib/native/platform';
import { ShadowAppBlocker, type InstalledApp } from '@/lib/native/app-blocker';
import { useShadowStore } from '@/store/shadow-store';
import { toast } from '@/hooks/use-toast';

export function AppBlockerCard() {
  const store = useShadowStore();
  const persisted = useMemo(
    () => store.userProfile?.blockedApps ?? [],
    [store.userProfile?.blockedApps],
  );

  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>(persisted);
  const [saving, setSaving] = useState(false);

  // Lista app installate dal plugin nativo. L'effetto e' guardato da isAndroid()
  // (su web non chiamiamo mai il plugin); gli hook restano comunque incondizionati.
  useEffect(() => {
    if (!isAndroid()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await ShadowAppBlocker.getInstalledApps();
        if (cancelled) return;
        const sorted = [...res.apps].sort((a, b) => a.label.localeCompare(b.label, 'it'));
        setApps(sorted);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Riallinea la selezione locale quando il profilo arriva/cambia dallo store.
  useEffect(() => {
    setSelected(persisted);
  }, [persisted]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (a) => a.label.toLowerCase().includes(q) || a.packageName.toLowerCase().includes(q),
    );
  }, [apps, search]);

  const toggle = useCallback((pkg: string) => {
    setSelected((prev) => (prev.includes(pkg) ? prev.filter((p) => p !== pkg) : [...prev, pkg]));
  }, []);

  const dirty = useMemo(() => {
    if (selected.length !== persisted.length) return true;
    const a = [...selected].sort();
    const b = [...persisted].sort();
    return a.some((v, i) => v !== b[i]);
  }, [selected, persisted]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockedApps: selected }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.profile) store.setUserProfile(data.profile);
      toast({
        title: 'App da bloccare salvate',
        description: `${selected.length} app in pausa durante lo strict mode`,
      });
    } catch {
      toast({
        title: 'Errore nel salvataggio',
        description: 'Riprova tra poco',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [selected, store]);

  // Su web/iOS lo scudo nativo non esiste: niente card.
  if (!isAndroid()) return null;

  return (
    <Card className="border-zinc-200 dark:border-zinc-800">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-500" /> App da bloccare
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <p className="text-xs text-zinc-500">
          Durante lo strict mode le app selezionate qui vengono messe in pausa. Senza selezione lo
          scudo non blocca nulla.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
          </div>
        ) : loadError ? (
          <p className="text-xs text-red-500 py-2">
            Impossibile leggere le app installate. Concedi il permesso di accesso all&apos;utilizzo e
            riprova.
          </p>
        ) : (
          <>
            <Input
              placeholder="Cerca app..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10"
            />
            <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {filtered.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-4">Nessuna app trovata</p>
              ) : (
                filtered.map((app) => (
                  <label
                    key={app.packageName}
                    htmlFor={`app-${app.packageName}`}
                    className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  >
                    <Checkbox
                      id={`app-${app.packageName}`}
                      checked={selected.includes(app.packageName)}
                      onCheckedChange={() => toggle(app.packageName)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{app.label}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{app.packageName}</p>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-500">{selected.length} selezionate</span>
              <Button size="sm" onClick={save} disabled={saving || !dirty}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvataggio...
                  </>
                ) : (
                  'Salva'
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
