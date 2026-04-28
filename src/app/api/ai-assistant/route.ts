// Shadow — AI Assistant API Route
// Handles conversational AI interactions, proactive interventions, and insights

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import {
  generateOnboardingQuestion,
  generateProactiveResponse,
  generateAIInsights,
  generateTaskRecommendation,
  detectProactiveTriggers,
  processMicroFeedbackAI,
  type OnboardingContext,
  type ProactiveTrigger,
} from '@/lib/engines/ai-assistant-engine';
import {
  generatePersonalizedNudge,
  recordNudgeOutcome,
  type NudgeContext,
} from '@/lib/engines/nudge-engine';
import { getAdaptiveScore, dbRecordToProfileData } from '@/lib/engines/learning-engine';
// Task in stato terminale (esclusi dalle viste live).
import { terminalTaskStatuses, type AdaptiveProfileData } from '@/lib/types/shadow';

// ── Helper: Get or create adaptive profile ───────────────────────────────────

async function getAdaptiveProfile(userId: string): Promise<AdaptiveProfileData | null> {
  try {
    const record = await db.adaptiveProfile.findUnique({
      where: { userId },
    });
    if (!record) return null;
    return dbRecordToProfileData(record as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
}

// Normalizza un delta Partial<AdaptiveProfileData> prima di passarlo a
// Prisma.adaptiveProfile.update/.upsert: rimuove `userId` (FK non
// aggiornabile via `data`) e serializza in JSON i campi che nello schema
// sono String @db.Text ma che i consumer del tipo ritornano come
// oggetti/array JS grezzi.
//
// Contesto: i 3 consumer di Partial<AdaptiveProfileData> in questo route
// (recordNudgeOutcome, generateProactiveResponse.profileUpdate,
// processMicroFeedbackAI.profileUpdates) popolano campi mappa/array come
// nudgeTypeEffectiveness come oggetti JS. Prisma 6 valida rigorosamente:
// object dove aspetta String → PrismaClientValidationError a runtime, che
// il try/catch muto dei caller silenzia. Effetto: prima di questo fix
// l'apprendimento nudge/proactive/micro-feedback non si persisteva mai,
// il profilo adattivo restava bloccato all'inizializzazione
// dell'onboarding. Nessuna data corruption (Prisma rifiuta a monte), solo
// silent failure scoperto durante Task 2.
//
// Guard: se un valore è già stringa non ri-stringifica, evitando
// double-encoding se in futuro un consumer ritorna già JSON serializzato.
//
// TODO(Task 10): questo è un fix tattico scoped al singolo route. Il fix
// sistematico richiede un helper centralizzato (toDbAdaptive) tipizzato
// contro Prisma.AdaptiveProfileUpdateInput e usato da tutti i consumer
// di Partial<AdaptiveProfileData>. Vedi ROADMAP Task 10 punto 4. Quando
// il rewrite sarà fatto, rimuovere questo helper locale e
// ignoreBuildErrors: true in next.config.ts.
const ADAPTIVE_JSON_FIELDS: ReadonlyArray<keyof AdaptiveProfileData> = [
  'nudgeTypeEffectiveness',
  'motivationProfile',
  'taskPreferenceMap',
  'energyRhythm',
  'bestTimeWindows',
  'worstTimeWindows',
  'categorySuccessRates',
  'categoryBlockRates',
  'categoryAvgResistance',
  'contextPerformanceRates',
  'timeSlotPerformance',
  'decompositionStyleEffectiveness',
  'commonFailureReasons',
  'commonSuccessConditions',
];

function toDbAdaptiveDelta(
  data: Partial<AdaptiveProfileData> | Record<string, unknown>,
): Record<string, unknown> {
  const { userId: _ignored, ...rest } = data as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  for (const key of ADAPTIVE_JSON_FIELDS) {
    const v = out[key];
    if (v !== undefined && v !== null && typeof v !== 'string') {
      out[key] = JSON.stringify(v);
    }
  }
  return out;
}

// ── Helper: Get time slot ────────────────────────────────────────────────────

function getTimeSlot(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// ── POST: AI Assistant Interaction ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { error, userId } = await requireSession(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      // ── Onboarding: generate next conversational question ──
      case 'onboarding_question': {
        const { step, answers } = body as { step: number; answers: Record<string, string | string[] | number | boolean> };
        const profile = await getAdaptiveProfile(userId);

        const context: OnboardingContext = {
          step: step || 0,
          answers: answers || {},
          profile,
        };

        const response = await generateOnboardingQuestion(context);
        return NextResponse.json({ response });
      }

      // ── Proactive: generate contextual intervention ──
      case 'proactive': {
        const { trigger, taskContext } = body as {
          trigger: ProactiveTrigger;
          taskContext?: { title: string; category: string; resistance: number } | null;
        };
        const profile = await getAdaptiveProfile(userId);

        const response = await generateProactiveResponse(trigger, profile, taskContext || null);

        if (response.profileUpdate && Object.keys(response.profileUpdate).length > 0 && profile) {
          try {
            await db.adaptiveProfile.update({
              where: { userId },
              data: toDbAdaptiveDelta(response.profileUpdate),
            });
          } catch {
            // Non-critical
          }
        }

        return NextResponse.json({ response });
      }

      // ── Insights: generate AI insights for current context ──
      case 'insights': {
        const profile = await getAdaptiveProfile(userId);
        if (!profile) {
          return NextResponse.json({ insights: [] });
        }

        const tasks = await db.task.findMany({
          where: { userId, status: { notIn: terminalTaskStatuses() } },
          take: 20,
          orderBy: { createdAt: 'desc' },
        });

        const currentTimeSlot = getTimeSlot();
        const taskSummaries = tasks.map(t => ({
          id: t.id,
          title: t.title,
          category: t.category,
          resistance: t.resistance,
          importance: t.importance,
          urgency: t.urgency,
          avoidanceCount: t.avoidanceCount,
          status: t.status,
        }));

        const insights = generateAIInsights(profile, taskSummaries, currentTimeSlot);

        return NextResponse.json({ insights });
      }

      // ── Task Recommendation ──
      case 'task_recommendation': {
        const { taskId } = body as { taskId: string };
        const profile = await getAdaptiveProfile(userId);
        if (!profile) {
          return NextResponse.json({ recommendation: null });
        }

        const task = await db.task.findFirst({ where: { id: taskId, userId } });
        if (!task) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        const currentTimeSlot = getTimeSlot();
        const adaptiveTaskCtx = {
          category: task.category,
          context: task.context || 'any',
          timeSlot: currentTimeSlot,
          resistance: task.resistance,
          size: task.size,
          importance: task.importance,
          urgency: task.urgency,
          delegable: task.delegable,
        };
        const adaptiveScore = getAdaptiveScore(adaptiveTaskCtx, profile, {
          timeSlot: currentTimeSlot,
          context: task.context || 'any',
        });

        const recommendation = generateTaskRecommendation(
          {
            id: task.id,
            title: task.title,
            category: task.category,
            resistance: task.resistance,
            importance: task.importance,
            urgency: task.urgency,
            avoidanceCount: task.avoidanceCount,
            size: task.size,
          },
          profile,
          adaptiveScore,
          currentTimeSlot
        );

        return NextResponse.json({ recommendation });
      }

      // ── Detect Triggers ──
      case 'detect_triggers': {
        const profile = await getAdaptiveProfile(userId);
        if (!profile) {
          return NextResponse.json({ triggers: [] });
        }

        const tasks = await db.task.findMany({
          where: { userId, status: { notIn: terminalTaskStatuses() } },
          take: 20,
        });

        const recentSignals = await db.learningSignal.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });

        const currentTimeSlot = getTimeSlot();
        const taskSummaries = tasks.map(t => ({
          id: t.id,
          title: t.title,
          category: t.category,
          resistance: t.resistance,
          importance: t.importance,
          urgency: t.urgency,
          avoidanceCount: t.avoidanceCount,
          status: t.status,
        }));

        const signalSummaries = recentSignals.map(s => ({
          signalType: s.signalType,
          category: s.category || undefined,
          timestamp: s.createdAt.toISOString(),
        }));

        const triggers = detectProactiveTriggers(profile, taskSummaries, signalSummaries, currentTimeSlot);

        return NextResponse.json({ triggers });
      }

      // ── Micro-Feedback: process with AI ──
      case 'micro_feedback': {
        const { feedbackType, response: feedbackResponse, taskContext } = body as {
          feedbackType: string;
          response: string | number;
          taskContext?: { category: string; resistance: number } | null;
        };
        const profile = await getAdaptiveProfile(userId);
        if (!profile) {
          return NextResponse.json({ insightMessage: 'Grazie per il feedback.' });
        }

        const result = processMicroFeedbackAI(feedbackType, feedbackResponse, profile, taskContext || null);

        if (Object.keys(result.profileUpdates).length > 0) {
          try {
            await db.adaptiveProfile.update({
              where: { userId },
              data: toDbAdaptiveDelta(result.profileUpdates),
            });
          } catch {
            // Non-critical
          }
        }

        for (const mem of result.memoryEntries) {
          try {
            const existing = await db.userMemory.findFirst({
              where: { userId, memoryType: mem.type, category: mem.category, key: mem.key },
            });
            if (existing) {
              await db.userMemory.update({
                where: { id: existing.id },
                data: {
                  value: mem.value,
                  strength: Math.min(1, existing.strength + 0.1 / Math.sqrt(existing.evidence + 1)),
                  evidence: existing.evidence + 1,
                  lastSeen: new Date(),
                },
              });
            } else {
              await db.userMemory.create({
                data: {
                  userId,
                  memoryType: mem.type,
                  category: mem.category,
                  key: mem.key,
                  value: mem.value,
                  strength: 0.5,
                  evidence: 1,
                  lastSeen: new Date(),
                },
              });
            }
          } catch {
            // Non-critical
          }
        }

        return NextResponse.json({
          insightMessage: result.insightMessage,
          profileUpdates: result.profileUpdates,
        });
      }

      // ── Nudge: generate personalized nudge ──
      case 'nudge': {
        const { nudgeContext, nudgesShownToday, lastNudgeTime } = body as {
          nudgeContext: NudgeContext;
          nudgesShownToday?: number;
          lastNudgeTime?: number | null;
        };
        const profile = await getAdaptiveProfile(userId);
        if (!profile) {
          return NextResponse.json({ nudge: null });
        }

        const nudge = generatePersonalizedNudge(
          profile,
          nudgeContext,
          undefined,
          nudgesShownToday || 0,
          lastNudgeTime || null
        );

        return NextResponse.json({ nudge });
      }

      // ── Nudge Outcome ──
      case 'nudge_outcome': {
        const { strategy, accepted } = body as { strategy: string; accepted: boolean };
        const profile = await getAdaptiveProfile(userId);
        if (!profile) {
          return NextResponse.json({ success: false });
        }

        const updates = recordNudgeOutcome(strategy as 'urgency' | 'reward' | 'relief' | 'identity' | 'challenge' | 'accountability' | 'curiosity' | 'momentum', accepted, profile);

        try {
          await db.adaptiveProfile.update({
            where: { userId },
            data: toDbAdaptiveDelta(updates),
          });
        } catch {
          // Non-critical
        }

        try {
          await db.learningSignal.create({
            data: {
              userId,
              signalType: accepted ? 'nudge_accepted' : 'nudge_ignored',
              metadata: JSON.stringify({ nudgeStrategy: strategy }),
            },
          });
        } catch {}

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('AI Assistant API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── GET: Get current AI insights ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { error, userId } = await requireSession(request);
  if (error) return error;

  try {
    const profile = await getAdaptiveProfile(userId);
    if (!profile) {
      return NextResponse.json({ insights: [], triggers: [] });
    }

    const tasks = await db.task.findMany({
      where: { userId, status: { notIn: terminalTaskStatuses() } },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    const currentTimeSlot = getTimeSlot();
    const taskSummaries = tasks.map(t => ({
      id: t.id,
      title: t.title,
      category: t.category,
      resistance: t.resistance,
      importance: t.importance,
      urgency: t.urgency,
      avoidanceCount: t.avoidanceCount,
      status: t.status,
    }));

    const insights = generateAIInsights(profile, taskSummaries, currentTimeSlot);

    const recentSignals = await db.learningSignal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const signalSummaries = recentSignals.map(s => ({
      signalType: s.signalType,
      category: s.category || undefined,
      timestamp: s.createdAt.toISOString(),
    }));

    const triggers = detectProactiveTriggers(profile, taskSummaries, signalSummaries, currentTimeSlot);

    return NextResponse.json({ insights, triggers });
  } catch (error) {
    console.error('AI Assistant GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
