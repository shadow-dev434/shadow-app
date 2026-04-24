import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

// Prisma client Edge-compatible per uso nel middleware (e in qualsiasi
// altro contesto Edge runtime). Usa il Neon Serverless Driver, che
// funziona senza TCP pool nativo e senza binding del query-engine
// (incompatibili con l'Edge runtime di Vercel).
//
// NON usare in route handler o Server Component che girano in Node.js:
// quelli devono continuare a importare `db` da `@/lib/db` (Prisma client
// standard con TCP pooling, piu' efficiente per query multiple nella
// stessa request).
//
// Background: il Task 2 hotfix #8.2 ha tentato di usare @/lib/db nel
// middleware per rileggere i flag onboarding dal DB. In locale `bunx
// next build` passava, ma in produzione Vercel il middleware gira in
// Edge runtime e Prisma Client standard crashava con:
//   prisma:error In order to run Prisma Client on edge runtime, either:
//     - Use Prisma Accelerate
//     - Use a driver adapter
// Il crash era silenziato dal try/catch nel middleware -> fallback sul
// JWT stale -> loop redirect. Fix #8.4: questo modulo con Neon adapter.
//
// API: PrismaNeon constructor prende neon.PoolConfig (non un Pool gia'
// istanziato); l'adapter gestisce internamente il ciclo di vita del
// pool. Verificato su @prisma/adapter-neon@6.19.3 dist/index.d.ts.
//
// Riferimento: https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-vercel

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });

export const dbEdge = new PrismaClient({ adapter });
