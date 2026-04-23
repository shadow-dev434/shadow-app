import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// Fail-fast guard: in produzione, se il client Prisma è stato buildato con
// uno schema stale (prisma generate non eseguito), i model mancano a runtime
// e le .create() falliscono con "cannot read properties of undefined".
// Meglio un errore chiaro al cold start che un crash in mezzo a una request.
if (process.env.NODE_ENV === 'production') {
  const required = ['user', 'task', 'chatThread', 'chatMessage', 'adaptiveProfile', 'dailyPlan', 'review'] as const;
  const missing = required.filter(m => !(m in db));
  if (missing.length > 0) {
    throw new Error(
      `Prisma client missing models: ${missing.join(', ')}. ` +
      `Build did not run "prisma generate" before "next build" — check package.json build script.`
    );
  }
}