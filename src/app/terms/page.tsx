import { LegalDoc } from '@/features/legal/LegalDoc';

export default function TermsPage() {
  return (
    <LegalDoc
      title={`Termini di servizio`}
      version={`Shadow · beta a inviti · versione 0.1`}
      sections={[
        {
          h: `1. Chi siamo`,
          blocks: [
            { p: `Shadow e' offerto da Giulio Errico, persona fisica, contattabile all'indirizzo egiulio.psi@gmail.com.` },
          ],
        },
        {
          h: `2. Cos'e' Shadow (e cosa non e')`,
          blocks: [
            { p: `Shadow e' un'app di organizzazione e benessere personale, a conversazione, pensata per adulti con ADHD: aiuta a raccogliere i propri impegni, fare una revisione serale e arrivare alla giornata con un piano.` },
            { p: `Shadow non e' un dispositivo medico, non fornisce diagnosi, terapie o trattamenti, non misura ne' riduce sintomi clinici e non e' un servizio di emergenza ne' di assistenza in caso di crisi. I contenuti e i suggerimenti hanno finalita' di supporto all'organizzazione e non sostituiscono il parere di un professionista (medico, psicologo, legale, finanziario).` },
          ],
        },
        {
          h: `3. Fase beta`,
          blocks: [
            { p: `Shadow e' in fase beta su invito: e' un servizio sperimentale, puo' cambiare, essere sospeso o interrotto in qualsiasi momento, puo' contenere errori e non offre garanzie di disponibilita' o continuita'.` },
          ],
        },
        {
          h: `4. Account e uso accettabile`,
          blocks: [
            { p: `Per usare Shadow crei un account con email e password: sei responsabile della custodia delle tue credenziali. Ti impegni a usare Shadow in modo lecito e a non abusarne (niente accessi non autorizzati, usi illeciti, o tentativi di compromettere il servizio o i dati altrui).` },
          ],
        },
        {
          h: `5. I tuoi contenuti`,
          blocks: [
            { p: `I contenuti che inserisci (compiti, conversazioni, contatti, note) restano tuoi. Ci autorizzi a trattarli per erogarti il servizio, nei modi e per le finalita' descritti nell'informativa privacy. Se inserisci dati di altre persone (contatti), inserisci solo i dati necessari.` },
          ],
        },
        {
          h: `6. Intelligenza artificiale`,
          blocks: [
            { p: `Per funzionare, Shadow utilizza un sistema di intelligenza artificiale (fornitore: Anthropic) per la parte conversazionale; ne sei informato all'avvio. Gli output dell'IA possono essere imprecisi: restano un supporto e non sostituiscono il tuo giudizio ne' pareri professionali.` },
          ],
        },
        {
          h: `7. Disagio acuto e situazioni di crisi`,
          blocks: [
            { p: `Shadow non e' un servizio di emergenza ne' di gestione delle crisi. Se ti trovi in pericolo o in una situazione di emergenza, contatta i servizi di emergenza competenti o una persona di fiducia.` },
          ],
        },
        {
          h: `8. Limitazione di responsabilita'`,
          blocks: [
            { p: `Shadow e' fornito "cosi' com'e'" e "come disponibile". Nei limiti consentiti dalla legge, non rispondiamo dei danni derivanti dall'uso o dall'impossibilita' di usare il servizio durante la beta.` },
          ],
        },
        {
          h: `9. Sospensione e cessazione`,
          blocks: [
            { p: `Possiamo sospendere o cessare l'accesso in caso di abuso o per necessita' tecniche o operative. Puoi smettere di usare Shadow quando vuoi e, dalle impostazioni, revocare il consenso o cancellare definitivamente il tuo account e i tuoi dati.` },
          ],
        },
        {
          h: `10. Modifiche ai Termini`,
          blocks: [
            { p: `Possiamo aggiornare questi Termini; in caso di modifiche sostanziali, incluso il passaggio della titolarita' a una societa' (SRL) in via di costituzione, te ne daremo comunicazione.` },
          ],
        },
        {
          h: `11. Legge applicabile e foro`,
          blocks: [
            { p: `I presenti Termini sono regolati dalla legge italiana.` },
          ],
        },
        {
          h: `12. Versione`,
          blocks: [
            { p: `Versione 0.1. La versione dei Termini che accetti viene registrata insieme al tuo consenso.` },
          ],
        },
      ]}
    />
  );
}
