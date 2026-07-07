/**
 * Task 72 (Slice D) — titolo suggerito da un testo OCR: la prima riga con
 * abbastanza sostanza (>= 4 tra lettere/cifre), normalizzata e cappata.
 * L'utente la può sempre riscrivere nella sheet di conferma.
 */
export function suggestTitleFromOcr(text: string): string {
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
  const meaningful = lines.find((l) => l.replace(/[^\p{L}\p{N}]/gu, '').length >= 4);
  const fallback = lines.find((l) => l.length > 0);
  return (meaningful ?? fallback ?? 'Documento fotografato').slice(0, 140);
}
