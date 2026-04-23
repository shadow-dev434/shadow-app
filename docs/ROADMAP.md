# ROADMAP — Shadow refactoring strutturale

Ordine di esecuzione dei task grossi. **Non cambiare l'ordine** senza motivo:
ogni task assume che i precedenti siano completi e in produzione.

---

## ✅ Completati

- **2026-04-XX** — 4 fix comportamentali (filtro contesto, timing feedback,
  completa-tutto, trigger strict mode). Vedi `CHANGELOG-4FIX.md`.

---

## 🔴 Task 1 — Data Isolation (CRITICO, IN CORSO)

**Spec completa**: `docs/tasks/01-data-isolation.md`

**Perché è urgente**: attualmente le API routes non filtrano per `userId`.
Se un secondo utente si registra su produzione, vede e può modificare i dati
del primo. È una breach di sicurezza. Va fixato prima di ogni altra cosa.

**Acceptance gate**: finché questo task non è chiuso e deployato, non passare
ai successivi.

---

## 🔴 Task 2 — Split `page.tsx`

**Spec**: `docs/tasks/02-split-page-tsx.md` *(da creare dopo che Task 1 è done)*

Il file `src/app/page.tsx` ha 3934 righe e 30+ componenti. Va splittato in
feature folder (`src/features/auth/`, `src/features/today/`, ecc.) mantenendo
comportamento identico.

**Perché non è il primo**: il monolite funziona. È un problema di manutenibilità,
non di sicurezza. La data isolation invece è pericolosa *oggi*.

---

## 🟠 Task 3 — Persist Zustand store

**Spec**: `docs/tasks/03-persist-store.md` *(da creare)*

Lo store Zustand vive solo in RAM: se l'utente chiude l'app mobile e riapre,
perde lo stato UI (focus view corrente, filtri, ecc.). Aggiungere `persist`
middleware con storage `localStorage` per i campi UI, escludendo dati
sensibili/server-authoritative.

---

## 🟠 Task 4 — Integrazione Gmail + Calendar

**Spec**: `docs/tasks/04-gmail-calendar.md` *(da creare)*

Google OAuth è già configurato per login. Estendere scope per leggere Gmail
(task da email) e scrivere eventi Calendar (task schedulati). Ingest pipeline
verso `/api/tasks` con auto-classificazione via AI.

---

## 🟡 Task 5 — Hardening produzione

**Spec**: `docs/tasks/05-hardening.md` *(da creare)*

Rate limiting auth, rate limiting AI, password policy, Sentry, UptimeRobot,
backup DB.

---

## Come lavorare su un task

1. Aprire Claude Code nella root del progetto: `claude`
2. Dire: `Leggi docs/tasks/NN-nome.md. Fai il piano e aspetta OK prima di scrivere codice.`
3. Rivedere il piano, approvare
4. Claude Code implementa, builda, committa (no push)
5. Fare push manualmente: `git push`
6. Verificare il deploy Vercel automatico
7. Testare gli acceptance criteria del task
8. Se tutto ok, marcare il task come ✅ in questo file
