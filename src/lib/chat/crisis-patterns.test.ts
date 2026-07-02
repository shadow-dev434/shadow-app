import { describe, it, expect } from 'vitest';
import { matchesCrisisPatterns } from './crisis-patterns';

describe('matchesCrisisPatterns', () => {
  it.each([
    'non ce la faccio più, voglio farla finita',
    'sto pensando al suicidio',
    'ho pensieri suicidi da giorni',
    'vorrei ammazzarmi',
    'ho voglia di uccidermi',
    'ho ricominciato a tagliarmi',
    'stasera ho paura di farmi del male',
    'non voglio più esserci',
    'non voglio più vivere così',
    'voglio morire',
    'sarebbe meglio morto per tutti',
    'a volte penso di togliermi la vita',
    'episodi di autolesionismo',
  ])('crisi forte → true: "%s"', (text) => {
    expect(matchesCrisisPatterns(text)).toBe(true);
  });

  it.each([
    // Scarico emotivo legittimo: il caso d'uso del tool, DEVE passare.
    'giornata di merda, sono a pezzi e non ho concluso niente',
    'mi sento uno schifo, oggi è andato tutto storto',
    'sono esausto, il capo mi ha massacrato',
    'che ansia questa settimana, non ne posso più del lavoro',
    // Lessico vicino ma non crisi.
    'devo ammazzare il tempo prima della riunione',
    'oggi ho ucciso la giornata a fare bollette',
    'mi fa male la schiena da morire',
  ])('sfogo/uso comune → false: "%s"', (text) => {
    expect(matchesCrisisPatterns(text)).toBe(false);
  });

  it('null/undefined/vuoto → false', () => {
    expect(matchesCrisisPatterns(null)).toBe(false);
    expect(matchesCrisisPatterns(undefined)).toBe(false);
    expect(matchesCrisisPatterns('')).toBe(false);
  });
});
