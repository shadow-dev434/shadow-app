import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// Interfaccia del plugin nativo `ShadowAppBlocker` (Android — Task 59 / W5-M5).
// Su web/iOS i metodi non vengono mai chiamati (la facade focus-shield fa da guard).

export interface BlockerPermissions {
  usageAccess: boolean;
  overlay: boolean;
  notifications: boolean;
}

export interface InstalledApp {
  packageName: string;
  label: string;
}

export interface StartBlockingOptions {
  /** Se assente/vuoto: blocca tutte le app launchabili tranne la whitelist di sistema. */
  packages?: string[];
  /** Epoch ms di fine sessione; <=0 o assente = nessun auto-stop. */
  endsAtEpochMs?: number | null;
  sessionId: string;
  overlayTitle?: string;
  overlayBody?: string;
}

export interface BlockerStatus {
  active: boolean;
  blockedAttempts: number;
  endsAtEpochMs: number | null;
}

export interface StopResult {
  blockedAttempts: number;
}

export interface BlockedAttemptEvent {
  packageName: string;
  blockedAttempts: number;
}

export interface ShadowAppBlockerPlugin {
  checkPermissions(): Promise<BlockerPermissions>;
  requestUsageAccess(): Promise<BlockerPermissions>;
  requestOverlayPermission(): Promise<BlockerPermissions>;
  requestNotificationPermission(): Promise<BlockerPermissions>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
  getInstalledApps(): Promise<{ apps: InstalledApp[] }>;
  startBlocking(options: StartBlockingOptions): Promise<void>;
  stopBlocking(): Promise<StopResult>;
  getStatus(): Promise<BlockerStatus>;
  addListener(
    eventName: 'blockedAttempt',
    listener: (event: BlockedAttemptEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const ShadowAppBlocker = registerPlugin<ShadowAppBlockerPlugin>('ShadowAppBlocker');
