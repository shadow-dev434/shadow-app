# J10 parte 1 — gate/bug-report/scoring (2026-07-04T10:34:35.927Z)
utenti: beta=cmr67iw2n00awibmkdhc6rmo2 admin=cmr67ix8300b2ibmk1ox3nsho nonbeta=cmr67iyb800b8ibmkw4hecymk today(Rome)=2026-07-04

## STEP R7 — login reale: claim isBetaTester nel JWT
claims beta (redatti): {"id":"cmr67iw2n00awibmkdhc6rmo2","sub":"cmr67iw2n00awibmkdhc6rmo2","email":"collaudo68-beta@probe.local","name":"C68 Beta","tourCompleted":true,"onboardingComplete":true,"consentGiven":true,"isBetaTester":true,"iat":1783161278,"exp":1785753278,"jti":"4fe9e64a-af62-4bce-bce6-6a831a2cc039"}
claims admin (redatti): {"id":"cmr67ix8300b2ibmk1ox3nsho","sub":"cmr67ix8300b2ibmk1ox3nsho","email":"collaudo68-admin@probe.local","name":"C68 Admin","tourCompleted":true,"onboardingComplete":true,"consentGiven":true,"isBetaTester":true,"iat":1783161281,"exp":1785753281,"jti":"5414d798-eda8-4e26-9be1-d59efba20984"}
claims nonbeta (redatti): {"id":"cmr67iyb800b8ibmkw4hecymk","sub":"cmr67iyb800b8ibmkw4hecymk","email":"collaudo68-nonbeta@probe.local","name":"C68 Nonbeta","tourCompleted":true,"onboardingComplete":true,"consentGiven":true,"isBetaTester":false,"iat":1783161283,"exp":1785753283,"jti":"2c3feb03-a7ca-408a-82dd-16a9811ca516"}

## STEP N22 — export GDPR per il non-beta (solo via API)
>> La card UI "Esporta dati" resta beta-only (tasks/page.tsx:3956-3957 isBetaTester): il diritto per il non-beta esiste SOLO via API — nessuna superficie UI.

## STEP R15 — bug report e2e: submit → triage admin → fixed → Notification+email
Notification: type=bug_fixed title="Segnalazione risolta 🎉" body="«COLLAUDO68 J10: dopo la review il piano di domani non mostra il terzo …» è stata sistemata. Grazie!"
>> Email tester: sendBugFixedEmail chiamato in-line (admin/beta/bug-reports/route.ts:126) con RESEND_API_KEY presente. Esito visibile SOLO nel log server ([bug-fixed-email] …); il destinatario probe.local non è consegnabile (sandbox Resend) → atteso invio fallito/accettato senza traccia DB. Il PASS meccanico R15 = Notification in DB (fatta) + tentativo email nel codice (best-effort, mai throw).

## STEP N55 — POST bug-report da NON beta (con severity blocking → alert email admin)
>> severityUser=blocking → sendBetaAlert eseguito (bug-report/route.ts:105-118): un qualunque utente registrato può generare email di alert "bloccante" all'admin. Esito invio solo nel log server (best-effort).

## STEP N52 — pulse + questionari T0 con scoring ricalcolato a mano
pulse 2° POST → 200; righe DB (user,kind,day)=1 answers={"mood":4,"usedToday":true,"note":"collaudo68 primo invio"}

spesa LLM (beta+admin+nonbeta): 0 USD (attesa 0: nessun turno chat in questo script)