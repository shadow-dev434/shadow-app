import { NextRequest, NextResponse } from 'next/server';
import { classifyTaskWithAI } from '@/lib/engines/profiling-engine';
import { db } from '@/lib/db';

// POST /api/ai-classify — classify a task using AI + user profile
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskTitle, taskDescription, userId, energy, timeAvailable, currentContext } = body;
    
    if (!taskTitle) {
      return NextResponse.json({ error: 'taskTitle is required' }, { status: 400 });
    }
    
    // Load user profile
    let profile: Record<string, unknown> | null = null;
    if (userId) {
      const profileRecord = await db.userProfile.findUnique({ where: { userId } });
      if (profileRecord) {
        profile = {
          id: profileRecord.id,
          userId: profileRecord.userId,
          role: profileRecord.role,
          occupation: profileRecord.occupation,
          age: profileRecord.age,
          livingSituation: profileRecord.livingSituation,
          hasChildren: profileRecord.hasChildren,
          householdManager: profileRecord.householdManager,
          cognitiveLoad: profileRecord.cognitiveLoad,
          responsibilityLoad: profileRecord.responsibilityLoad,
          timeConstraints: profileRecord.timeConstraints,
          lifeContext: profileRecord.lifeContext,
          executionStyle: profileRecord.executionStyle,
          preferredSessionLength: profileRecord.preferredSessionLength,
          focusModeDefault: profileRecord.focusModeDefault,
          mainResponsibilities: JSON.parse(profileRecord.mainResponsibilities),
          difficultAreas: JSON.parse(profileRecord.difficultAreas),
          blockedApps: JSON.parse(profileRecord.blockedApps),
        };
      }
    }
    
    const result = await classifyTaskWithAI({
      taskTitle,
      taskDescription: taskDescription || '',
      profile,
      energy: energy ?? 3,
      timeAvailable: timeAvailable ?? 480,
      currentContext: currentContext ?? 'any',
    });
    
    return NextResponse.json({ classification: result });
  } catch (error) {
    console.error('POST /api/ai-classify error:', error);
    return NextResponse.json({ error: 'Classification failed' }, { status: 500 });
  }
}
