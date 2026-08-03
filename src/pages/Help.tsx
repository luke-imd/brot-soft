// Statische Bedienungsanleitung. ponytail: reiner Text, kein Markdown-Renderer nötig.
export default function Help() {
  return (
    <div className="card space-y-6 p-6 leading-relaxed sm:p-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight mb-1">Anleitung</h1>
        <p className="text-zinc-500">
          So funktioniert die Garagen-Verwaltung. Bei Fragen: an die Hausverwaltung wenden.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">So funktioniert's</h2>
        <p>
          Wer einen Garagenplatz hat, gibt ihn frei, wenn er ihn nicht braucht — zum Beispiel im
          Urlaub. Alle anderen können freigegebene Plätze <b>stundengenau</b> buchen. Pro
          angefangenem Tag kostet eine Buchung die <b>Tagespauschale von 3 €</b> — egal ob du den
          Platz zwei Stunden oder den ganzen Tag nutzt. Den Überblick, wem welcher Platz gehört,
          gibt der Tab <b>Garage</b> mit dem Garagenplan.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Einen Platz buchen</h2>
        <ol className="list-decimal list-inside space-y-1">
          <li>Tab <b>Kalender</b> öffnen (Startseite) und einen Tag mit „frei" anklicken.</li>
          <li>Einen freien Platz aufklappen — dort stehen die freien Uhrzeiten.</li>
          <li>Zeitraum „von Datum + Uhrzeit bis Datum + Uhrzeit" einstellen (volle Stunden).</li>
          <li>Auf <b>Buchen</b> klicken — der Button zeigt vorher den Preis an.</li>
        </ol>
        <p className="text-zinc-500 text-sm mt-2">
          Sobald du buchst, schuldest du dem Besitzer den Betrag (er erscheint automatisch unter
          „Meine Buchungen"). Buchen zwei Leute denselben Platz am selben Tag zu verschiedenen
          Uhrzeiten, zahlt jeder die volle Tagespauschale. Deinen eigenen Platz kannst du nicht buchen.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Deinen Platz eintragen &amp; freigeben</h2>
        <p>
          Hast du einen Garagenplatz, trag ihn im Tab <b>Kalender</b> unter <b>Mein Platz</b> ein
          (einmalig, geht auch schon bei der Registrierung). Danach kannst du dort Zeiträume
          <b> freigeben</b> — dann sehen alle anderen den Platz als frei und können ihn buchen.
          Über <b>Zurückziehen</b> nimmst du noch nicht gebuchte Zeiten wieder heraus.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Eine Buchung stornieren</h2>
        <p>
          Brauchst du den Platz doch nicht? Im Tab <b>Meine Buchungen</b> bei der Buchung auf
          <b> Stornieren</b> klicken — möglich bis zum Tag vor Buchungsbeginn. Der Platz wird wieder
          frei und deine Schuld verschwindet. Danach (oder wenn die Schuld schon beglichen ist) geht
          es nicht mehr.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Schulden &amp; „beglichen"</h2>
        <p>
          Der Tab <b>Meine Buchungen</b> zeigt für alle sichtbar, wer wem was schuldet — das ist
          Absicht, damit es transparent bleibt. Wenn du eine Schuld bezahlt (oder bezahlt bekommen)
          hast, klick bei dem Posten auf <b>Schulden beglichen</b>. Sowohl der Schuldner als auch
          der Besitzer dürfen das machen. Es wird festgehalten, wer und wann geklickt hat.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Der Garagenplan</h2>
        <p>
          Im Tab <b>Garage</b> siehst du den Plan von Objekt 2 mit den Platznummern 1–23 und wem
          welcher Platz gehört. Die Plätze 5, 7 und 19 sind Fahrrad-Abstellplätze, auf Platz 9 steht
          der Traktor — diese sind nicht buchbar.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Passwort ändern</h2>
        <p>
          Oben rechts auf <b>Passwort ändern</b> klicken, neues Passwort zweimal eingeben, speichern. Passwort
          vergessen? Auf der Login-Seite auf „Passwort vergessen?" klicken — du bekommst einen Link
          per E-Mail.
        </p>
      </section>
    </div>
  )
}
