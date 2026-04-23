import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';

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

        const user = await db.user.findUnique({
          where: { email: credentials.email },
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
        const profile = await db.userProfile.findUnique({
          where: { userId: user.id },
          select: { tourCompleted: true, onboardingComplete: true },
        });
        token.tourCompleted = profile?.tourCompleted ?? false;
        token.onboardingComplete = profile?.onboardingComplete ?? false;
      }
      // Refresh esplicito dal client (dopo completion onboarding o reset):
      // ricarica i flag dal DB in modo che il middleware veda subito il
      // nuovo stato.
      if (trigger === 'update' && typeof token.id === 'string') {
        const profile = await db.userProfile.findUnique({
          where: { userId: token.id },
          select: { tourCompleted: true, onboardingComplete: true },
        });
        token.tourCompleted = profile?.tourCompleted ?? false;
        token.onboardingComplete = profile?.onboardingComplete ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.id === 'string') {
        session.user.id = token.id;
        session.user.tourCompleted = token.tourCompleted ?? false;
        session.user.onboardingComplete = token.onboardingComplete ?? false;
      }
      return session;
    },
  },
  pages: {
    signIn: '/?auth=login',
    error: '/?auth=error',
  },
  secret: process.env.NEXTAUTH_SECRET || 'shadow-secret-change-in-production',
};
