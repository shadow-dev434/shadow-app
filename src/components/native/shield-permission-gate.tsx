'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, ShieldAlert } from 'lucide-react';
import { isAndroid } from '@/lib/native/platform';
import { ShadowAppBlocker, type BlockerPermissions } from '@/lib/native/app-blocker';
import { SHIELD_PERMISSION_EVENT, getShieldPermissions, shieldReady } from '@/lib/native/focus-shield';

/**
 * Disclosure + richiesta permessi dello scudo nativo (Task 59 / W5-M5).
 * Mostrato quando lo strict mode parte ma mancano Usage Access / overlay.
 * Prominent disclosure PRIMA della richiesta (requisito Play). No-op fuori da Android.
 */
export function ShieldPermissionGate() {
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<BlockerPermissions | null>(null);

  const refresh = useCallback(async () => {
    setPerms(await getShieldPermissions());
  }, []);

  useEffect(() => {
    if (!isAndroid()) return;
    const onNeeded = () => {
      void refresh();
      setOpen(true);
    };
    window.addEventListener(SHIELD_PERMISSION_EVENT, onNeeded);
    // Quando l'utente torna da Settings, ri-controlla i permessi.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(SHIELD_PERMISSION_EVENT, onNeeded);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  if (!isAndroid()) return null;

  const ready = shieldReady(perms);

  const row = (
    label: string,
    desc: string,
    granted: boolean,
    onGrant: () => Promise<unknown>,
  ) => (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      {granted ? (
        <span className="flex items-center gap-1 text-xs text-green-500">
          <Check className="h-4 w-4" /> Attivo
        </span>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => void onGrant().then(refresh)}>
          Attiva
        </Button>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-indigo-400" />
            Blocco app durante il focus
          </DialogTitle>
          <DialogDescription>
            Per mettere in pausa le app che ti distraggono durante una sessione, Shadow ha
            bisogno di due permessi di sistema. Sei tu a deciderlo per te stesso: questi dati
            restano sul telefono e servono solo a mostrarti un promemoria quando apri un&apos;app
            mentre sei in focus.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {row(
            'Accesso utilizzo',
            'Per capire quale app è in primo piano durante la sessione.',
            !!perms?.usageAccess,
            () => ShadowAppBlocker.requestUsageAccess(),
          )}
          {row(
            'Mostra sopra le altre app',
            'Per mostrare il promemoria "Torna a Shadow" sopra l\'app aperta.',
            !!perms?.overlay,
            () => ShadowAppBlocker.requestOverlayPermission(),
          )}
          {row(
            'Notifiche',
            'Per la notifica della sessione focus in corso.',
            !!perms?.notifications,
            () => ShadowAppBlocker.requestNotificationPermission(),
          )}
          {row(
            'Batteria senza limiti (consigliato)',
            'Evita che il sistema interrompa il blocco in background.',
            false,
            () => ShadowAppBlocker.requestIgnoreBatteryOptimizations(),
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={() => setOpen(false)} disabled={!ready}>
            {ready ? 'Fatto' : 'Concedi i permessi richiesti'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
