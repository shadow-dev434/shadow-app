/**
 * Etichette italiane delle categorie task (Task 70 I/N38).
 *
 * Gli enum grezzi ('work', 'personal', …) sono il dominio interno e NON
 * vanno mostrati all'utente. Le label coincidono con quelle di CATEGORIES
 * in tasks/page.tsx (che restano lì con le loro icone: qui solo il testo,
 * condivisibile dalla chat).
 */

export const CATEGORY_LABELS: Record<string, string> = {
  general: 'Generale',
  work: 'Lavoro',
  personal: 'Personale',
  health: 'Salute',
  admin: 'Amministrazione',
  creative: 'Creatività',
  study: 'Studio',
  household: 'Casa',
};

/** Etichetta italiana della categoria; l'enum grezzo solo come ultima spiaggia. */
export function categoryLabel(category: string | null | undefined): string | null {
  if (!category) return null;
  return CATEGORY_LABELS[category] ?? category;
}
