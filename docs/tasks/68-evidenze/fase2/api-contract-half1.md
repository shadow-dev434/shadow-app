# Contratto API — METÀ 1 (Fase 2, §8.1)

| Route | Metodo | Caso | Status | Atteso | Esito |
|---|---|---|---|---|---|
| health | GET | happy | 200 | 200 | PASS |
| account | DELETE | 401 | 401 | 401 | PASS |
| account | DELETE | invalid | 400 | 4xx | PASS |
| account | DELETE | happy | 200 | 2xx | PASS |
| adaptive-profile | GET | 401 | 401 | 401 | PASS |
| adaptive-profile | POST | 401 | 401 | 401 | PASS |
| adaptive-profile | PATCH | 401 | 401 | 401 | PASS |
| adaptive-profile | GET | happy | 200 | 2xx/404 | PASS — body={"profile":null} |
| adaptive-profile | POST | happy | 201 | 2xx | PASS — body={"profile":{"id":"cmr6a7ns102fuibe4w62c8i0e","userId":"cmr6a7d720000iby48evhaqrp |
| adaptive-profile | POST | invalid | 409 | 4xx (409 ok) | PASS |
| adaptive-profile | PATCH | happy | 200 | 2xx | PASS — body={"profile":{"id":"cmr6a7ns102fuibe4w62c8i0e","userId":"cmr6a7d720000iby48evhaqrp |
| ai-assistant | POST | 401 | 401 | 401 | PASS |
| ai-assistant | GET | 401 | 401 | 401 | PASS |
| ai-assistant | GET | happy | 200 | 2xx | PASS |
| ai-assistant | POST | happy | 200 | 2xx | PASS — body={"insights":[]} |
| ai-assistant | POST | invalid | 400 | 400 | PASS |
| ai-classify | POST | 401 | 401 | 401 | PASS |
| ai-classify | POST | happy | 200 | 2xx | PASS — body={"classification":{"importance":3,"urgency":2,"resistance":1,"size":1,"delegable |
| ai-classify | POST | invalid | 400 | 400 | PASS |
| beta/assessment | GET | 401 | 401 | 401 | PASS |
| beta/assessment | PATCH | 401 | 404 | 401 | FAIL |
| beta/assessment | GET | invalid | 200 | 404 (non-beta gate) | FAIL — nonbeta |
| beta/assessment | GET | happy | 200 | 2xx | PASS — body={"responses":[{"instrument":"asrs","wave":"pre","itemScores":{"a1":2,"a2":3,"a3" |
| beta/assessment | PATCH | invalid | 400 | 400 | PASS |
| beta/assessment | PATCH | happy | 400 | 2xx | FAIL — body={"error":"invalid instrument"} |
| beta/bug-report | GET | 401 | 401 | 401 | PASS |
| beta/bug-report | POST | 401 | 401 | 401 | PASS |
| beta/bug-report | GET | happy | 200 | 2xx | PASS |
| beta/bug-report | POST | happy | 200 | 2xx | PASS — body={"report":{"id":"cmr6a81qu02gaibe4x2uks723","status":"new","createdAt":"2026-07- |
| beta/bug-report | POST | invalid | 400 | 400 | PASS |
| beta/feedback | POST | 401 | 401 | 401 | PASS |
| beta/feedback | POST | happy | 400 | 2xx | FAIL — body={"error":"invalid kind"} |
| beta/feedback | POST | invalid | 400 | 400 | PASS |
| beta/feedback/status | GET | 401 | 401 | 401 | PASS |
| beta/feedback/status | GET | happy | 400 | 2xx | FAIL |
| body-double/chat | POST | 401 | 401 | 401 | PASS |
| body-double/chat | POST | invalid | 400 | 400 | PASS |
| body-double/chat | POST | happy | 200 | 2xx | PASS — body={"text":"Ok, bloccato dove esattamente — cosa ti ferma in questo momento? È il t |
| body-double/checkin | POST | 401 | 401 | 401 | PASS |
| body-double/checkin | POST | invalid | 400 | 400 | PASS |
| body-double/checkin | POST | happy | 200 | 2xx | PASS — body={"text":"Sono qui con te, tranquillo se il ritmo è lento all'inizio.","costUsd": |
| calendar | GET | 401 | 401 | 401 | PASS |
| calendar | POST | 401 | 401 | 401 | PASS |
| calendar | PUT | 401 | 401 | 401 | PASS |
| calendar | GET | happy | 200 | 2xx | PASS — body={"events":[]} |
| calendar | POST | invalid | 400 | 400 | PASS |
| calendar | POST | happy | 200 | 2xx | PASS — body={"success":true,"message":"Token Google Calendar salvato"} |
| calendar | PUT | happy/invalid | 400 | 2xx or 4xx (never 500) | PASS — status=400 |
| calendar/oauth | GET | 401 | 307 | 401 or 3xx-to-login | PASS — status=307 |
| calendar/oauth | GET | happy | 404 | 2xx/3xx | FAIL — status=404 loc=undefined |
| calendar/oauth/callback | GET | 401 | 307 | 3xx-to-login (no session) | PASS — loc=http://localhost:3000/?auth=login&calendar=error&msg=no_session |
| calendar/oauth/callback | GET | invalid | 307 | 3xx (no_code) | PASS — loc=http://localhost:3000/?action=settings&calendar=error&msg=no_code |
| chat/active-thread | GET | 401 | 401 | 401 | PASS |
| chat/active-thread | GET | happy | 200 | 2xx | PASS — body={"activeThread":null,"eveningReview":{"shouldStart":false}} |
| chat/bootstrap | POST | 401 | 401 | 401 | PASS |
| chat/bootstrap | POST | happy | 200 | 2xx | PASS — body={"triggered":true,"threadId":"cmr6a8q1d02guibe40unswyv1","mode":"morning_checkin |
| chat/bootstrap | POST | invalid | 200 | 2xx/4xx (never 500) | PASS — status=200 |
| chat/evening-signal | GET | 401 | 401 | 401 | PASS |
| chat/evening-signal | GET | happy | 200 | 2xx | PASS — body={"shouldStart":false} |
| chat/evening-signal | GET | invalid | 200 | 2xx/4xx (never 500) | PASS — status=200 |
| chat/threads | GET | 401 | 401 | 401 | PASS |
| chat/threads | GET | happy | 200 | 2xx | PASS |
| chat/threads/[id] | GET | 401 | 401 | 401 | PASS |
| chat/threads/[id] | GET | happy | 200 | 2xx | PASS — body={"thread":{"id":"cmr6a8zwa000uiby4pxejzdn4","mode":"general" |
| chat/threads/[id] | GET | invalid | 404 | 404 | PASS |
| chat/turn | POST | 401 | 401 | 401 | PASS |
| chat/turn | POST | invalid | 400 | 4xx (never 500) | PASS — status=400 |
| chat/turn | POST | happy | 200 | 2xx | PASS — status=200 |
| consent | POST | 401 | 401 | 401 | PASS |
| consent | DELETE | 401 | 401 | 401 | PASS |
| consent | POST | invalid | 400 | 400 | PASS |
| consent | POST | happy | 200 | 2xx | PASS — body={"ok":true} |
| consent | DELETE | happy | 200 | 2xx | PASS |
| contacts | GET | 401 | 401 | 401 | PASS |
| contacts | POST | 401 | 401 | 401 | PASS |
| contacts | GET | happy | 200 | 2xx | PASS |
| contacts | POST | invalid | 400 | 400 | PASS |
| contacts | POST | happy | 200 | 2xx | PASS — body={"contact":{"id":"cmr6a9fnt02hkibe4f6731lw8","userId":"cmr6a7d720000iby48evhaqrp |
| contacts/[id] | DELETE | 401 | 401 | 401 | PASS |
| contacts/[id] | PATCH | 401 | 401 | 401 | PASS |
| contacts/[id] | PATCH | happy | 200 | 2xx | PASS — body={"contact":{"id":"cmr6a9jh60013iby49dyx3y7o","userId":"cmr6a |
| contacts/[id] | DELETE | happy | 200 | 2xx | PASS |
| contacts/[id] | DELETE | invalid | 404 | 404 (never 500) | PASS — status=404 |
| contacts/[id] | PATCH | invalid | 404 | 4xx (never 500) | PASS — status=404 |
| daily-plan | POST | 401 | 401 | 401 | PASS |
| daily-plan | GET | 401 | 401 | 401 | PASS |
| daily-plan | PATCH | 401 | 401 | 401 | PASS |
| daily-plan | GET | happy | 200 | 2xx | PASS — body={"plan":null} |
| daily-plan | POST | happy | 200 | 2xx | PASS — body={"plan":{"id":"cmr6a9vpp02hwibe43nmqb8m7","userId":"cmr6a7d7 |
| daily-plan | POST | invalid | 500 | 2xx/4xx (never 500) | FAIL — status=500 |
| daily-plan | PATCH | invalid | 200 | 4xx (never 500) | PASS — status=200 |
| decompose | POST | 401 | 401 | 401 | PASS |
| decompose | POST | happy | 200 | 2xx | PASS — body={"steps":[{"id":"0e9e2377-726b-4c29-918a-9294c9506811","text |
| decompose | POST | invalid | 400 | 400 | PASS |
| export | GET | 401 | 401 | 401 | PASS |
| export | GET | happy | 200 | 2xx | PASS — ct=application/json |
| export | GET | happy-csv | 200 | 2xx (never 500) | PASS — status=200 |
| learning-signal | GET | 401 | 401 | 401 | PASS |
| learning-signal | POST | 401 | 401 | 401 | PASS |
| learning-signal | GET | happy | 200 | 2xx | PASS — body={"signals":[]} |
| learning-signal | GET | invalid | 500 | 2xx (never 500) | FAIL — status=500 |
| learning-signal | POST | happy | 200 | 2xx | PASS — body={"signal":{"id":"cmr6aai5q02itibe4q2569dg5","userId":"cmr6a7 |
| learning-signal | POST | invalid | 400 | 400 | PASS |