import type { UserProfileData } from '@/store/shadow-store';

// Helper estratto da src/app/tasks/page.tsx durante il Task 2. Oggi chiama
// ancora /api/profile direttamente; nel commit #7 sarà sostituito dal
// nuovo endpoint /api/onboarding/complete.

export async function saveProfile(
  data: Record<string, unknown>,
): Promise<{ profile: UserProfileData; executiveProfile: Record<string, unknown> }> {
  const res = await fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}
