import { LegalDoc } from '@/features/legal/LegalDoc';

export default function AccountDeletionPage() {
  return (
    <LegalDoc
      title={`Eliminazione dell'account e dei dati`}
      version={`Shadow · beta a inviti`}
      sections={[
        {
          h: `1. Applicazione e titolare`,
          blocks: [
            { p: `Shadow è un'applicazione per adulti con ADHD, attualmente in fase beta su invito. Il titolare del trattamento dei dati è Giulio Errico, persona fisica, contattabile all'indirizzo egiulio.psi@gmail.com.` },
            { p: `Questa pagina spiega come richiedere l'eliminazione del tuo account Shadow e dei dati collegati, quali dati vengono eliminati e che cosa resta.` },
          ],
        },
        {
          h: `2. Come eliminare il tuo account`,
          blocks: [
            { p: `Puoi eliminare il tuo account in due modi.` },
            { p: `Metodo 1 - Dall'app (eliminazione immediata e irreversibile):` },
            { ul: [
              `Accedi a Shadow e apri la scheda "Impost." (icona a forma di ingranaggio) nella barra di navigazione in basso.`,
              `Nella sezione "Account", tocca "Elimina account e dati".`,
              `Digita ELIMINA per confermare.`,
              `Tocca "Elimina definitivamente": il tuo account e tutti i dati collegati vengono eliminati subito e in modo irreversibile, e vieni disconnesso da Shadow.`,
            ] },
            { p: `Metodo 2 - Via email:` },
            { p: `Se non riesci ad accedere all'app, scrivi a egiulio.psi@gmail.com dall'indirizzo email del tuo account, indicando che vuoi eliminare l'account e i dati. Evadiamo la richiesta entro 30 giorni.` },
          ],
        },
        {
          h: `3. Quali dati vengono eliminati`,
          blocks: [
            { p: `Quando elimini il tuo account vengono cancellati in modo definitivo tutti i dati collegati al tuo profilo. In particolare:` },
            { ul: [
              `Account e credenziali: email, nome, password (in forma cifrata) e gli accessi collegati, incluso l'accesso con Google.`,
              `Compiti — incluse le catture arrivate da condivisione o da foto (testo estratto e link) — piani giornalieri e revisioni serali.`,
              `Conversazioni con Shadow: tutti i messaggi che hai scambiato con l'app.`,
              `Stato d'animo, energia e riflessioni raccolti durante le revisioni.`,
              `Profilo comportamentale e dati di apprendimento costruiti dal tuo uso dell'app.`,
              `Dati raccolti in fase di onboarding: età, situazione abitativa, presenza di figli, aree di difficoltà.`,
              `Il record del consenso che hai prestato.`,
              `Impostazioni e preferenze.`,
              `Contatti che hai inserito.`,
              `Notifiche e iscrizione alle notifiche push.`,
              `Streak e statistiche di utilizzo.`,
              `Sessioni della modalità Strict.`,
              `Collegamento a Google Calendar (token di accesso), se lo avevi attivato.`,
            ] },
            { p: `L'eliminazione è completa: non conserviamo una copia anonimizzata dei tuoi dati.` },
          ],
        },
        {
          h: `4. Quali dati vengono conservati e per quanto`,
          blocks: [
            { p: `Nel database di Shadow non resta nulla che ti riguardi: l'eliminazione rimuove subito e per intero i tuoi dati, senza copie anonimizzate.` },
            { p: `Al di fuori del database dell'app possono restare soltanto, per il tempo previsto dai rispettivi fornitori, eventuali log tecnici di funzionamento e i contenuti delle conversazioni inviati al fornitore di intelligenza artificiale (al quale non vengono trasmessi il tuo nome né la tua email). Questi trattamenti sono descritti nell'informativa privacy, disponibile alla pagina /privacy.` },
          ],
        },
        {
          h: `5. Eliminare dati o revocare il consenso senza cancellare l'account`,
          blocks: [
            { p: `Se non vuoi eliminare l'account, dalle impostazioni dell'app (scheda "Impost.", sezione "Account") hai altre due possibilità:` },
            { ul: [
              `Revocare il consenso: tocca "Revoca il consenso". Questo ferma il trattamento dei tuoi dati finché non lo riconcedi, ma non cancella i dati già salvati.`,
              `Esportare i tuoi dati: nella sezione "Esporta dati" tocca "Esporta JSON" per scaricare una copia dei tuoi dati.`,
            ] },
          ],
        },
      ]}
    />
  );
}
