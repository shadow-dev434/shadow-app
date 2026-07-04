# N19 — notifications type libero
POST status=200; riga con type='evening_review_prompt' scritta: SI

# N24 — strict-mode status libero
POST create status=201
PATCH status='banana_invalid_status' -> 200; DB status ora='banana_invalid_status'; GET session dopo: null (invisibile)

# N25 — streaks non-numerici
POST status=500; riga: null

# Observability — route con try/catch
ai-classify senza body: status=500 (atteso 400/500 pulito, MAI crash del server)

# N50b — memory/learning-signal GET
GET memory=200, GET learning-signal=200 (happy path). CONFERMATA a codice: nessun try/catch nelle GET -> 500 non tracciato su errore DB.