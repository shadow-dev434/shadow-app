import type { ReactNode } from 'react';
import {
  GraduationCap, Briefcase, FileText, BookOpen, Baby, User,
  Users, Home, Heart, Palette, Wrench, BarChart3, MessageCircle,
} from 'lucide-react';
import { createElement } from 'react';

// Costanti usate dall'onboarding. Estratte da src/app/tasks/page.tsx durante
// il Task 2 (estrazione OnboardingView). Nessun'altra view le usa.

export interface OnboardingOption {
  value: string;
  label: string;
  icon?: ReactNode;
  emoji?: string;
}

export const ROLES: OnboardingOption[] = [
  { value: 'student', label: 'Studente', icon: createElement(GraduationCap, { className: 'w-5 h-5' }) },
  { value: 'worker', label: 'Lavoratore', icon: createElement(Briefcase, { className: 'w-5 h-5' }) },
  { value: 'freelancer', label: 'Freelancer', icon: createElement(FileText, { className: 'w-5 h-5' }) },
  { value: 'both', label: 'Studente + Lavoratore', icon: createElement(BookOpen, { className: 'w-5 h-5' }) },
  { value: 'parent', label: 'Genitore', icon: createElement(Baby, { className: 'w-5 h-5' }) },
  { value: 'other', label: 'Altro', icon: createElement(User, { className: 'w-5 h-5' }) },
];

export const LIVING_SITUATIONS: OnboardingOption[] = [
  { value: 'alone', label: 'Da solo/a' },
  { value: 'family', label: 'Con la famiglia' },
  { value: 'partner', label: 'Con il partner' },
  { value: 'roommates', label: 'Con coinquilini' },
  { value: 'parents', label: 'Con i genitori' },
];

export const DIFFICULT_AREAS: OnboardingOption[] = [
  { value: 'bureaucracy', label: 'Burocrazia', icon: createElement(FileText, { className: 'w-4 h-4' }) },
  { value: 'study', label: 'Studio', icon: createElement(BookOpen, { className: 'w-4 h-4' }) },
  { value: 'creative_work', label: 'Lavoro creativo', icon: createElement(Palette, { className: 'w-4 h-4' }) },
  { value: 'house', label: 'Gestione casa', icon: createElement(Home, { className: 'w-4 h-4' }) },
  { value: 'admin', label: 'Amministrazione', icon: createElement(Wrench, { className: 'w-4 h-4' }) },
  { value: 'social', label: 'Relazioni sociali', icon: createElement(Users, { className: 'w-4 h-4' }) },
  { value: 'health', label: 'Salute', icon: createElement(Heart, { className: 'w-4 h-4' }) },
  { value: 'finance', label: 'Finanze', icon: createElement(BarChart3, { className: 'w-4 h-4' }) },
];

export const ONBOARDING_LOAD_SOURCES: OnboardingOption[] = [
  { value: 'work', label: 'Lavoro', icon: createElement(Briefcase, { className: 'w-4 h-4' }) },
  { value: 'study', label: 'Studio', icon: createElement(GraduationCap, { className: 'w-4 h-4' }) },
  { value: 'family', label: 'Famiglia', icon: createElement(Users, { className: 'w-4 h-4' }) },
  { value: 'house', label: 'Casa', icon: createElement(Home, { className: 'w-4 h-4' }) },
  { value: 'bureaucracy', label: 'Burocrazia', icon: createElement(FileText, { className: 'w-4 h-4' }) },
  { value: 'health', label: 'Salute', icon: createElement(Heart, { className: 'w-4 h-4' }) },
  { value: 'finance', label: 'Finanze', icon: createElement(BarChart3, { className: 'w-4 h-4' }) },
  { value: 'relationships', label: 'Relazioni', icon: createElement(MessageCircle, { className: 'w-4 h-4' }) },
];

export const ONBOARDING_MOTIVATIONS: OnboardingOption[] = [
  { value: 'urgency', label: 'Paura della scadenza', emoji: '⏰' },
  { value: 'reward', label: 'Ricompensa', emoji: '🎁' },
  { value: 'identity', label: 'Senso di dovere', emoji: '💪' },
  { value: 'curiosity', label: 'Interesse', emoji: '🔍' },
  { value: 'accountability', label: 'Pressione esterna', emoji: '👥' },
  { value: 'relief', label: 'Sollievo', emoji: '😌' },
  { value: 'approval', label: 'Approvazione', emoji: '⭐' },
];
