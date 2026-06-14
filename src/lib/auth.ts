import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { getAuthSecret } from '@/lib/auth-secret';
import { isAdminEmail } from '@/lib/beta/admin-guard';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Normalizzata come in fase di registrazione (lowercase + trim):
        // le email sono memorizzate normalizzate, qui matchiamo uguale.
        const user = await db.user.findUnique({
          where: { email: credentials.email.trim().toLowerCase() },
        });

        if (!user || !user.password) return null;

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user, trigger }) {
      // Primo sign-in: popola id + carica i flag onboarding dal DB.
      if (user) {
        token.id = user.id;
        // Tester beta = email nell'allowlist ADMIN_EMAILS (stessa lista del
        // gate /admin/beta). Solo il booleano risolto finisce nel JWT/sessione,
        // mai la lista email.
        token.isBetaTester = isAdminEmail(user.email);
        const profile = await db.userProfile.findUnique({
          where: { userId: user.id },
          select: { tourCompleted: true, onboardingComplete: true, consentGivenAt: true },
        });
        token.tourCompleted = profile?.tourCompleted ?? false;
        token.onboardingComplete = profile?.onboardingComplete ?? false;
        token.consentGiven = profile?.consentGivenAt != null;
      }
      // Refresh esplicito dal client (dopo completion onboarding o reset):
      // ricarica i flag dal DB in modo che il middleware veda subito il
      // nuovo stato.
      if (trigger === 'update' && typeof token.id === 'string') {
        token.isBetaTester = isAdminEmail(typeof token.email === 'string' ? token.email : null);
        const profile = await db.userProfile.findUnique({
          where: { userId: token.id },
          select: { tourCompleted: true, onboardingComplete: true, consentGivenAt: true },
        });
        token.tourCompleted = profile?.tourCompleted ?? false;
        token.onboardingComplete = profile?.onboardingComplete ?? false;
        token.consentGiven = profile?.consentGivenAt != null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === 'string') {
        session.user.id = token.id;
        session.user.tourCompleted = token.tourCompleted ?? false;
        session.user.onboardingComplete = token.onboardingComplete ?? false;
        session.user.consentGiven = token.consentGiven ?? false;
        session.user.isBetaTester = token.isBetaTester ?? false;
      }
      return session;
    },
  },
  pages: {
    signIn: '/?auth=login',
    error: '/?auth=error',
  },
  secret: getAuthSecret(),
};
