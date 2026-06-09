import { LegalDoc } from '@/features/legal/LegalDoc';

export default function PrivacyPage() {
  return (
    <LegalDoc
      title={`Informativa sul trattamento dei dati personali`}
      version={`Shadow · beta a inviti · versione 0.2`}
      sections={[
        {
          h: `1. Titolare del trattamento`,
          blocks: [
            { p: `Il titolare del trattamento e' Giulio Errico, persona fisica, contattabile all'indirizzo egiulio.psi@gmail.com.` },
          ],
        },
        {
          h: `2. Premessa`,
          blocks: [
            { p: `Shadow e' un'applicazione di gestione dei compiti, a conversazione, pensata per adulti con ADHD. E' attualmente in fase beta su invito. Questa informativa descrive quali dati trattiamo, perche', con quali strumenti e quali diritti hai. Ti chiediamo di leggerla prima di iniziare.` },
          ],
        },
        {
          h: `3. Quali dati trattiamo`,
          blocks: [
            { ul: [
              `Dati di registrazione e accesso: email, nome, password (conservata in forma cifrata).`,
              `Contenuto delle conversazioni con Shadow: i messaggi che scambi con l'app, comprese le review serali.`,
              `Stato d'animo, energia e riflessioni: come ti senti, cosa ti ha bloccato o ti sei trovato a evitare.`,
              `Profilo comportamentale: un profilo su come affronti i compiti, costruito dalle tue risposte e dal tuo uso dell'app.`,
              `Dati raccolti in fase di onboarding: eta', situazione abitativa, presenza di figli, aree di difficolta'.`,
              `Compiti e contatti che inserisci. I contatti possono contenere dati di terze persone (vedi sezione 7-bis).`,
              `Dati tecnici e di funzionamento (log operativi).`,
              `Se colleghi Google Calendar: token di accesso e dati degli eventi del tuo calendario.`,
            ] },
          ],
        },
        {
          h: `4. Dati appartenenti a categorie particolari (art. 9 GDPR)`,
          blocks: [
            { p: `Alcuni dati che tratti con Shadow riguardano il tuo stato di salute o benessere psicologico (per esempio l'ADHD, l'umore, lo scarico emotivo durante le conversazioni). Questi rientrano nelle categorie particolari di dati ai sensi dell'art. 9 GDPR e godono di una protezione rafforzata.` },
            { p: `Trattiamo questi dati solo sulla base del tuo consenso esplicito (art. 9, par. 2, lett. a). Senza questo consenso non possiamo offrirti la funzione conversazionale e di personalizzazione e, poiche' sono l'essenza di Shadow, l'app non puo' funzionare.` },
          ],
        },
        {
          h: `5. Finalita' del trattamento e basi giuridiche`,
          blocks: [
            { ul: [
              `Fornirti il servizio (creare il piano, condurre la review, la chat): esecuzione del servizio (art. 6, par. 1, lett. b).`,
              `Trattare i dati relativi alla salute per la funzione conversazionale e personalizzare il supporto: consenso esplicito (art. 9, par. 2, lett. a, e art. 6, par. 1, lett. a).`,
              `Sicurezza e corretto funzionamento (log): legittimo interesse (art. 6, par. 1, lett. f).`,
            ] },
          ],
        },
        {
          h: `6. Profilazione`,
          blocks: [
            { p: `Shadow costruisce un profilo comportamentale per personalizzare i suggerimenti e l'ordine di priorita' dei compiti. Questa profilazione avviene con logiche deterministiche interne all'applicazione (non tramite un modello di intelligenza artificiale esterno) e non produce decisioni con effetti giuridici o similmente significativi nei tuoi confronti. Hai diritto di ricevere informazioni su questa logica, di opporti e di chiedere la correzione o l'azzeramento del profilo (vedi sezione 10).` },
          ],
        },
        {
          h: `7. A chi comunichiamo i dati`,
          blocks: [
            { p: `Per far funzionare Shadow ci avvaliamo di alcuni fornitori che trattano dati per nostro conto, sulla base di accordi sul trattamento (DPA) e, ove i dati siano trattati fuori dall'UE, di Clausole Contrattuali Standard:` },
            { ul: [
              `Anthropic (USA): il modello di intelligenza artificiale che alimenta la conversazione. Per i propri prodotti commerciali/API, Anthropic per impostazione predefinita non utilizza i dati per addestrare i propri modelli e cancella i contenuti inviati tramite API entro circa 30 giorni.`,
              `Neon: conserva i dati dell'applicazione (database in regione UE).`,
              `Vercel: esegue l'applicazione e ne conserva i log operativi (esecuzione in regione UE; alcuni dati tecnici, come l'indirizzo IP per la protezione anti-DDoS, possono transitare per gli USA).`,
              `Google: solo se colleghi il calendario, per leggere e scrivere i tuoi eventi.`,
              `Servizio di notifiche push: solo se attivi le notifiche.`,
            ] },
            { p: `Per ridurre i dati esposti, i tuoi dati identificativi (email, nome) non vengono inviati ad Anthropic. Non mostriamo pubblicita' e non vendiamo i tuoi dati.` },
          ],
        },
        {
          h: `7-bis. Contatti che inserisci`,
          blocks: [
            { p: `Se inserisci contatti (nome, email, telefono, note), trattiamo dati di persone diverse da te, che potrebbero non essere a conoscenza di questo trattamento. Ti chiediamo di inserire solo i dati necessari.` },
          ],
        },
        {
          h: `8. Trasferimenti fuori dall'Unione Europea`,
          blocks: [
            { p: `Alcuni fornitori (Anthropic, Vercel, Google) hanno sede o possono trattare dati negli Stati Uniti. Tali trasferimenti sono disciplinati dalle Clausole Contrattuali Standard (SCC) e, ove applicabile, dalla certificazione Data Privacy Framework dei fornitori; per il database e l'esecuzione dell'applicazione abbiamo scelto regioni UE ove disponibili, cosi' da minimizzare i dati trasferiti.` },
          ],
        },
        {
          h: `9. Per quanto tempo conserviamo i dati`,
          blocks: [
            { p: `Conserviamo i tuoi dati per il tempo in cui usi Shadow. In particolare:` },
            { ul: [
              `finche' il tuo account e' attivo;`,
              `in caso di inattivita' prolungata, cancelliamo i dati dopo 12 mesi di inattivita';`,
              `puoi chiederne la cancellazione in qualsiasi momento: la eseguiamo entro 30 giorni (vedi sezione 10);`,
              `al termine della fase beta, cancelliamo i dati.`,
            ] },
            { p: `Quando cancelliamo, cancelliamo davvero i dati: non li conserviamo in forma anonimizzata.` },
          ],
        },
        {
          h: `10. I tuoi diritti`,
          blocks: [
            { p: `Hai diritto di: accedere ai tuoi dati (art. 15), chiederne la rettifica (art. 16) o la cancellazione (art. 17), ottenere la limitazione del trattamento (art. 18), ricevere i dati in forma portabile (art. 20), opporti al trattamento (art. 21) e revocare il consenso in qualsiasi momento (art. 7, par. 3, senza pregiudicare i trattamenti gia' svolti). Puoi esercitare la cancellazione, l'export e la revoca del consenso direttamente dalle impostazioni dell'app.` },
            { p: `Per esercitare questi diritti puoi anche scrivere a egiulio.psi@gmail.com. Hai inoltre diritto di proporre reclamo al Garante per la protezione dei dati personali (art. 77).` },
          ],
        },
        {
          h: `11. Modifiche all'informativa`,
          blocks: [
            { p: `Potremmo aggiornare questa informativa. In caso di modifiche sostanziali, incluso il passaggio della titolarita' dalla persona fisica alla societa' (SRL) in via di costituzione, te ne daremo comunicazione.` },
          ],
        },
        {
          h: `12. Versione`,
          blocks: [
            { p: `Versione 0.2. La versione dell'informativa che accetti viene registrata insieme al tuo consenso.` },
          ],
        },
      ]}
    />
  );
}
