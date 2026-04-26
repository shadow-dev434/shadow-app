---
name: post-mortem
description: Genera un post-mortem strutturato per un bug debuggato, seguendo il pattern dei doc Task 2 e Task 3.5 di Shadow. Include storia numerata dei tentativi, root cause, lezione metodologica.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git show:*), Write
---

# /post-mortem — Documentazione di un debug ostico

Genera un post-mortem markdown nel formato consolidato di Shadow.

## Quando usarlo

Solo quando Antonio invoca esplicitamente `/post-mortem`. Tipicamente alla
fine di un task complesso che ha richiesto più tentativi. NON auto-invocare.

Esempi di invocazione:
- `/post-mortem Task 2 onboarding navigation bug`
- `/post-mortem` (senza argomenti → chiedi quale bug documentare)

## Procedura

1. **Identifica lo scope.** Se Antonio ha passato un argomento (es. "Task 2"
   o "race condition SW"), partire da lì. Altrimenti chiedi:
   - Qual è il bug/task da documentare?
   - In che file dovrei salvare il post-mortem? (default:
     `docs/tasks/NN-nome-task.md`)

2. **Raccogli evidenze dalla storia git.** Usa `git log --oneline -50` per
   trovare i commit relativi. Cerca pattern come "fix", "Step N", numeri di
   tentativo (#8.1, #8.2). Identifica il commit che ha chiuso il bug.

3. **Per ogni tentativo precedente fallito**, raccogli con `git show <hash>`:
   - Cosa è stato cambiato
   - Perché era ragionevole provarlo
   - Perché non ha funzionato

4. **Scrivi il post-mortem** usando questa struttura. Niente sezioni di
   filler. Solo le sezioni che hanno contenuto reale.

## Struttura standard

```markdown
# [Task N] — [Nome bug] (POST-MORTEM)

> Stato: [✅ Risolto / ⚠️ Parziale] — [data ISO]
> Commit di chiusura: `<hash>` ([branch/tag])

## Sintomo

[1-3 frasi: cosa vedeva l'utente, cosa NON funzionava. Senza diagnosi
ancora.]

## Storia dei tentativi

[Numerazione progressiva. Ogni tentativo: cosa abbiamo provato, hash del
commit, perché era ragionevole, perché ha fallito. Sii specifico — niente
"non ha funzionato" generico.]

### Tentativo #N.M (`<hash>`) — [titolo breve]

**Ipotesi:** [cosa pensavamo fosse la causa]
**Cambio:** [cosa è stato modificato in concreto, file:linea se serve]
**Risultato:** [perché ha fallito, con evidenza concreta — log, errore,
test failing, comportamento osservato in produzione]

## Root cause confermata

[1-2 paragrafi. La causa vera del bug, identificata definitivamente.
Includi una riga forte che dichiari la categoria — es. "qualsiasi
strategia X è fragile per costruzione". Quella riga vale oro per chi
leggerà tra 6 mesi.]

## Soluzione finale (Tentativo #N)

**Approccio:** [in 1-2 frasi, la strategia che ha funzionato]
**File modificati:**
- `path/to/file1.ts` — [cosa cambia in 1 riga]
- `path/to/file2.ts` — [cosa cambia in 1 riga]

**Trade-off accettati:** [se ci sono. Es. "1 query HTTP in più per
request, ~50ms — accettabile per beta, da rivedere in Task X".]

## Lezione metodologica

[Una o due lezioni concrete e operative. NON generiche tipo "abbiamo
imparato a essere pazienti". Devono essere regole operative che proteggono
chi verrà dopo dallo stesso errore. Esempi reali da Shadow:
- "`bunx next build` locale non dice quale runtime Vercel sceglierà in
  produzione → verifica sempre sui Vercel logs post-deploy"
- "Quando il SW intercetta richieste, enumera TUTTI i path di intercept
  prima di concludere che la causa è altrove".]

## Follow-up registrati

[Bug minori scoperti durante il debug ma fuori scope. Linka al backlog
ROADMAP se applicabile. Una riga ciascuno.]

- [ ] [Descrizione] → ROADMAP Task X.Y
- [ ] [Descrizione] → backlog
```

## Regole di scrittura

- **Niente gloria.** Numera i fallimenti 1, 2, 3 prima del fix finale.
  Non dire "abbiamo imparato" — dì "è stato così".
- **Precisione empirica.** Cita errori testualmente, non parafrasati.
  Hash dei commit espliciti tra parentesi.
- **Self-contained.** Chi apre il file fra 6 mesi deve capire tutto senza
  leggere altri file. Niente rimandi tipo "vedi chat del 25 aprile".
- **Sotto le 600 righe.** Se serve di più, sposta materiale di reference
  in file separati e linkalo.
- **Niente bullet points dove la prosa va meglio.** Per la root cause e
  la lezione metodologica, scrivi in paragrafi. I bullet sono per liste
  di file, hash, follow-up.

## Output finale

Salva il file in `docs/tasks/NN-nome-task.md`. Mostra a Antonio:
1. Il path del file creato
2. Le prime 30 righe come anteprima
3. Aspetta conferma prima di proporre commit. Il commit message deve
   essere `docs: post-mortem Task N — [breve titolo]`.

Non committare automaticamente — Antonio approva commit e push manualmente
come da convenzione consolidata in Shadow.
