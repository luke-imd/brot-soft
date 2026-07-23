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
        <h2 className="text-lg font-bold tracking-tight mb-2">Die drei Farben</h2>
        <ul className="space-y-1">
          <li className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 bg-zinc-400 rounded" />
            <span><b>Grau</b> — der Besitzer nutzt den Platz selbst, nicht buchbar.</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 bg-emerald-500 rounded" />
            <span><b>Grün</b> — frei, du kannst ihn buchen.</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 bg-blue-500 rounded" />
            <span><b>Blau</b> — von dir gebucht.</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 bg-orange-400 rounded" />
            <span><b>Orange</b> — von jemand anderem gebucht.</span>
          </li>
        </ul>
        <p className="text-zinc-500 text-sm mt-2">
          Die Farbe gilt immer für den oben gewählten Tag und Halbtag (Vormittag/Nachmittag).
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Vormittag &amp; Nachmittag</h2>
        <p>
          Jeder Tag hat zwei Hälften: <b>Vormittag</b> (0–12 Uhr) und <b>Nachmittag</b> (12–24 Uhr).
          Du kannst einen ganzen Tag oder nur eine Hälfte buchen. Ein voller Tag kostet den
          Tagessatz, ein Halbtag die Hälfte.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Einen Platz buchen</h2>
        <ol className="list-decimal list-inside space-y-1">
          <li>Tab <b>Garage</b> oder <b>Kalender</b> öffnen.</li>
          <li>Oben den gewünschten Tag (und Vor-/Nachmittag) wählen.</li>
          <li>Auf einen <b>grünen</b> Platz klicken (Garage) bzw. im Kalender auf einen Tag und dann den Platz aufklappen.</li>
          <li>Zeitraum „von–bis" einstellen und auf <b>Buchen</b> klicken.</li>
        </ol>
        <p className="text-zinc-500 text-sm mt-2">
          Sobald du buchst, schuldest du dem Besitzer den Betrag (er landet automatisch im Tab
          „Ledger"). Deinen eigenen Platz kannst du nicht buchen.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Deinen Platz freigeben (nur Besitzer)</h2>
        <p>
          Bist du auf Urlaub oder brauchst deinen Platz nicht? Im Tab <b>Garage</b> deinen eigenen
          Platz anklicken, unter <b>Freigeben</b> den Zeitraum wählen und bestätigen. Dann sehen ihn
          alle anderen als frei und können ihn buchen. Über <b>Freigabe zurückziehen</b> nimmst du
          noch nicht gebuchte Zeiten wieder heraus.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Eine Buchung stornieren</h2>
        <p>
          Solange die Buchung noch nicht begonnen hat, kannst du sie stornieren: den Platz im Tab
          <b> Garage</b> anklicken und auf <b>Buchung stornieren</b> klicken. Der Platz wird wieder
          frei und deine Schuld verschwindet. Nach Beginn der Buchung geht das nicht mehr.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Schulden &amp; „beglichen"</h2>
        <p>
          Der Tab <b>Ledger</b> zeigt für alle sichtbar, wer wem was schuldet — das ist Absicht,
          damit es transparent bleibt. Wenn du eine Schuld bezahlt (oder bezahlt bekommen) hast,
          klick bei dem Posten auf <b>Schulden beglichen</b>. Sowohl der Schuldner als auch der
          Besitzer dürfen das machen. Es wird festgehalten, wer und wann geklickt hat.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Passwort ändern</h2>
        <p>
          Oben rechts auf <b>Passwort</b> klicken, neues Passwort eingeben, speichern. Passwort
          vergessen? Auf der Login-Seite auf „Passwort vergessen?" klicken — du bekommst einen Link
          per E-Mail.
        </p>
      </section>
    </div>
  )
}
