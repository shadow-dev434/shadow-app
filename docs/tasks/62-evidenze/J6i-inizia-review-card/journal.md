# J6(i) + D31 — Tap "Inizia la review" dalla card [UI]

Utente: collaudo-strict, finestra serale forzata 00:00-23:59, nessuna review oggi.

## Repro
1. GET /api/chat/evening-signal → `{shouldStart:true}` (in finestra, no review, no thread evening).
2. Chat mostra la card: **"Sei nella finestra serale. Vuoi iniziare la review?" [Inizia la review]**.
3. Tap "Inizia la review".

## Osservato — **D31 CONFERMATO (peggiore del previsto)**
- Dopo il tap la chat **ritorna all'empty state GENERICO**: "Ciao, sono Shadow… Oppure inizia
  da qui: **Pianifichiamo oggi / Ho un task nuovo / Cosa ho in lista? / Sono bloccato / Come
  funziona Shadow?**" — chip di mode `general`, **fuori contesto** per una review serale.
- **DB: nessun thread creato** (0 ChatThread per l'utente dopo il tap). La review **non parte
  affatto**: Shadow non apre la conversazione, non c'è intake mood/energia, niente.
- Il passo 3 del core loop ("la review serale prepara il piano di domani") è **inavviabile da
  questa card**: è il punto d'ingresso pubblicizzato della serata e fa no-op.

## Severità
S2 — rompe una promessa core del loop (la review serale). L'utente che accetta l'invito
serale finisce in una chat vuota con suggerimenti sbagliati e nessuna via ovvia per fare la
review. (Nota: la review conversazionale È raggiungibile scrivendo a mano in chat / via il
flusso morning-evening, ma NON dal bottone dedicato che la propone.)

## Riferimento codice (dal dossier, da confermare in Fase 5)
`ChatView.tsx:538-558` — il tap non innesca un primo turno assistant né crea il thread evening.
