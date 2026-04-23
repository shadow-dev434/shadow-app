import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      tourCompleted: boolean;
      onboardingComplete: boolean;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    tourCompleted?: boolean;
    onboardingComplete?: boolean;
  }
}
