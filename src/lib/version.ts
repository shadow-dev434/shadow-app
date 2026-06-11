// Versione dell'app esposta al client. Iniettata a build time da
// next.config.ts (env NEXT_PUBLIC_APP_VERSION, letta da package.json).
// Allegata a ogni bug report e taggata sugli eventi Sentry.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';
