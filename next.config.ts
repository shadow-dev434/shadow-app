import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  reactStrictMode: false,
  env: {
    // Versione app esposta al client (bug report, tag Sentry, Impostazioni).
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    // DSN Sentry inlinato esplicitamente: Turbopack non sostituisce in modo
    // affidabile process.env.NEXT_PUBLIC_* dentro instrumentation-client.ts,
    // quindi passiamo dal canale env del config (come APP_VERSION).
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
  },
  // Security header (audit pre-beta): app con dati art.9 servita anche in WebView.
  // microphone=(self) perché la quick-capture vocale usa SpeechRecognition
  // (tasks/page.tsx); camera/geolocation non usate (la vision è upload file, non
  // getUserMedia). Niente CSP qui: richiede setup nonce con Next e va testata in
  // browser prima di attivarla (rischio di rompere script inline) — follow-up.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), browsing-topics=()' },
        ],
      },
    ];
  },
};

// Il wrapper Sentry agisce solo a build time (source maps, release).
// Senza SENTRY_AUTH_TOKEN la build degrada senza errori (stack minificati).
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
});
