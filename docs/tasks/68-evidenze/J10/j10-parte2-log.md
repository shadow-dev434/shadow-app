# J10 parte 2 — GDPR utente effimero (2026-07-04T10:38:25.568Z) BASE_URL=http://localhost:3000
utente effimero: collaudo68-j10-gdpr@probe.local id=cmr68bm630000ibgsj6almzco

## STEP N23 — export JSON: inclusioni ed esclusioni
>> AppConfig: tabella GLOBALE key-value (model_routing/pricing/budget, schema.prisma:756) senza userId → non è dato dell'utente, correttamente fuori dall'export.
chiavi totali export: 204; top-level: 33
CSV: 4 righe fisiche, header=id,title,description,importance,urgency,resistance,size,category,context,quadrant,decision,status,priorityScore,avoidanceCount,deadline,completedAt,createdAt
>> NB (già noto dal 62): il CSV copre SOLO i task — non è un export GDPR completo.

## STEP R6a — revoca consenso → 403 consent_required su ≥6 route

## STEP R6b — delete account: cascade + vecchia sessione 401 session_invalid
pre-delete: {"user":1,"tasks":2,"threads":1,"messages":2,"notifications":1,"pushDevices":1,"calendarTokens":1,"recurring":1,"signals":1}

spesa LLM utente effimero (post-cascade): 0 USD