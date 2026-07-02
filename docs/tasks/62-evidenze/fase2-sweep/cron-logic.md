# Cron review — logica (senza invio)

1. in-finestra, no review → shouldStart=true [atteso true]
2. dedup: marcatore oggi presente=true → la cron farebbe skip [atteso true]
3. con Review-oggi → shouldStart=false [atteso false]
4. opt-out: candidato con notif-off=false → NON riceve email [atteso false]
5. fuori finestra (20:00-20:01, ora 04:21) → shouldStart=false [atteso false]