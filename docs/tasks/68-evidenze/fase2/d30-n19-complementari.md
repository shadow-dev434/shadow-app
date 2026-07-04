# D30 / N19 complementari

1. D30 (parziale SMENTITA): campi arbitrari fuori whitelist NON accettati — POST/PATCH adaptive-profile filtrano con whitelist (jsonFields/directFields), i campi ignoti vengono droppati in silenzio (HTTP 201).
2. D30 (variante CONFERMATA): POST adaptive-profile con campo whitelisted di tipo sbagliato (executiveLoad='pippo' su colonna Float) → HTTP 500: nessuna validazione di tipo prima della scrittura Prisma → 500 non-pulito su input invalido.