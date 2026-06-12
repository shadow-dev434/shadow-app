'use client';

import { useSearchParams } from 'next/navigation';
import { BodyDoubleView } from '@/features/body-double/BodyDoubleView';

export function FocusPageClient() {
  const searchParams = useSearchParams();
  const taskId = searchParams.get('taskId');
  return <BodyDoubleView taskId={taskId} />;
}
