'use client';

import type { ReactNode } from 'react';
import { useState, useCallback } from 'react';
import { useShadowStore } from '@/store/shadow-store';
import { APP_TOUR_STEPS } from '@/lib/types/shadow';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Inbox, Sparkles, Brain, Target, Shield, ClipboardCheck,
  MessageCircle, ChevronLeft, ChevronRight, Zap,
} from 'lucide-react';

// TourView estratto da src/app/tasks/page.tsx (Task 2). In questo commit
// il monolite non viene toccato: il nuovo modulo è dormiente. Il
// ricollegamento e la rimozione delle definizioni duplicate avvengono
// nel commit #8 del Task 2 (chore cleanup).
//
// handleFinish contiene ancora la logica legacy di setCurrentView
// ('inbox' | 'onboarding'): in questo commit la behavior resta
// identica. La nuova transizione via router.push('/onboarding') +
// NextAuth session update() sarà introdotta più avanti nel Task 2.

// Map icon name string (from APP_TOUR_STEPS) to lucide React component.
function getTourIcon(iconName: string): ReactNode {
  const iconMap: Record<string, ReactNode> = {
    Inbox: <Inbox className="w-12 h-12" />,
    Sparkles: <Sparkles className="w-12 h-12" />,
    Brain: <Brain className="w-12 h-12" />,
    Target: <Target className="w-12 h-12" />,
    Shield: <Shield className="w-12 h-12" />,
    ClipboardCheck: <ClipboardCheck className="w-12 h-12" />,
  };
  return iconMap[iconName] || <Zap className="w-12 h-12" />;
}

export function TourView() {
  const store = useShadowStore();
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = APP_TOUR_STEPS.length;
  const step = APP_TOUR_STEPS[currentStep];

  const handleFinish = useCallback(async () => {
    store.setTourCompleted(true);
    localStorage.setItem('shadow-tour-completed', 'true');

    // Save tour completion to profile API
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tourCompleted: true, tourStep: totalSteps }),
      });
    } catch {}

    // Check if onboarding is needed
    const profileComplete = localStorage.getItem('shadow-profile-complete') === 'true';
    if (profileComplete && store.userProfile?.onboardingComplete) {
      store.setCurrentView('inbox');
    } else {
      store.setCurrentView('onboarding');
    }
  }, [store, totalSteps]);

  const handleNext = useCallback(() => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
      store.setTourStep(currentStep + 1);
    } else {
      handleFinish();
    }
  }, [currentStep, totalSteps, store, handleFinish]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      store.setTourStep(currentStep - 1);
    }
  }, [currentStep, store]);

  const handleSkip = useCallback(() => {
    handleFinish();
  }, [handleFinish]);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2">
          {APP_TOUR_STEPS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => { setCurrentStep(idx); store.setTourStep(idx); }}
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                idx === currentStep ? 'bg-amber-500 w-6' : idx < currentStep ? 'bg-amber-700' : 'bg-zinc-700'
              }`}
              aria-label={`Step ${idx + 1}`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="text-center space-y-4 animate-in fade-in duration-300" key={currentStep}>
          {/* Icon */}
          <div className="w-20 h-20 rounded-2xl bg-amber-600/20 flex items-center justify-center mx-auto text-amber-500">
            {getTourIcon(step.icon)}
          </div>

          {/* Title & Description */}
          <div>
            <h2 className="text-xl font-bold text-white">{step.title}</h2>
            <p className="text-zinc-400 text-sm mt-2 leading-relaxed">{step.description}</p>
          </div>

          {/* Example card */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <MessageCircle className="w-3 h-3" /> Esempio pratico
              </p>
              <p className="text-sm text-zinc-300 italic">{step.example}</p>
            </CardContent>
          </Card>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-4">
          <div>
            {currentStep > 0 ? (
              <Button variant="ghost" onClick={handleBack} className="text-zinc-400 hover:text-white">
                <ChevronLeft className="w-4 h-4 mr-1" /> Indietro
              </Button>
            ) : (
              <Button variant="ghost" onClick={handleSkip} className="text-zinc-500 hover:text-zinc-300 text-sm">
                Salta
              </Button>
            )}
          </div>
          <span className="text-xs text-zinc-600">{currentStep + 1}/{totalSteps}</span>
          <div>
            {currentStep < totalSteps - 1 ? (
              <Button onClick={handleNext} className="bg-amber-600 hover:bg-amber-700 text-white">
                Avanti <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleFinish} className="bg-amber-600 hover:bg-amber-700 text-white">
                Inizia <Zap className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
