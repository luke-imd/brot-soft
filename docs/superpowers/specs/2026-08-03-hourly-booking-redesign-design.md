# Design: Stundenbuchung, Tagespauschale, echter Garagenplan, Selbst-Registrierung von Plätzen

Datum: 2026-08-03. Basiert auf User-Feedback zur ersten Testrunde. Ersetzt Teile von `2026-07-23-garage-management-design.md` (Halbtags-Modell).

## Ziele

1. Buchen/Freigeben in **Stunden** statt Halbtagen, als durchgehender Zeitraum „von Datum+Uhrzeit bis Datum+Uhrzeit".
2. Abrechnung **pauschal pro angefangenem Kalendertag**: 3 €/Tag, egal wie viele Stunden. Zwei Bucher am selben Tag zahlen je die volle Pauschale.
3. Echter **Garagenplan** (23 Plätze, Objekt 2 Kalksburg) statt Platzhalter-Grid; Bild um 180° gedreht (Original ist über Kopf).
4. **Kalender ist Startseite** und trägt Buchen + Freigeben. **Garage-Tab bleibt**, aber rein zur Orientierung (nicht interaktiv).
5. User können ihren **Platz selbst eintragen** — bei der Registrierung über den Einladungslink und nachträglich — und sich als **Platzsucher** markieren.
6. **Ledger-Tab heißt „Meine Buchungen"** und enthält zusätzlich die eigenen künftigen Buchungen mit Storno.
7. Anleitung komplett auf den neuen Flow umgeschrieben.

## Entscheidungen (mit Auftraggeber geklärt)

- Tagessatz: **300 Cents (3 €)**, pauschal pro Tag. Halbtage entfallen ersatzlos.
- Plätze: **1–23** laut Plan. **5, 7, 9, 19 sind inaktiv** (5/7/19 Fahrrad, 9 Traktor) — existieren in der App, sind aber nie zuweisbar/buchbar. 1 und 14 sind normal (gelbe Kreuze im Plan bedeuten dort nichts). Platz 24 (Alt-Seed) wird entfernt.
- Freigeben wandert in den **Kalender**.
- Platzwahl bei Registrierung **und** nachträglich, jeweils frei aus besitzerlosen aktiven Plätzen. Admin kann weiterhin alles korrigieren.
- „Sucher" ist rein informativ (Anzeige in der Admin-User-Liste), keine weitere Funktion.

## Schema-Ansatz: Stunden-Zeilen (gewählt)

`free_slots` behält sein Muster, nur feiner: statt `half ('am'/'pm')` eine Spalte **`hour` (int, 0–23)**, PK **`(spot_id, date, hour)`**. Doppelbuchung bleibt DB-seitig unmöglich (PK + bedingtes `UPDATE … WHERE booking_id is null`). Verworfen: Zeitintervalle mit Exclusion-Constraint — eleganter, aber neue Mechanik und mehr Umbau, lohnt bei 23 Plätzen nicht.

Ein Zeitraum „Fr 15:00 – So 18:00" ⇒ Stunden-Zeilen Fr 15–23, Sa 0–23, So 0–17. Endzeit ist exklusiv (18:00 = bis 18 Uhr, Stunde 18 gehört nicht mehr dazu). Nur volle Stunden.

## Migration `0006` (additiv, via Supabase-MCP)

1. `free_slots`: Spalte `hour int not null check (hour between 0 and 23)` einführen, Bestandsdaten konvertieren (`am` → Stunden 0–11, `pm` → 12–23, Buchungszuordnung bleibt erhalten), `half` entfernen, PK auf `(spot_id, date, hour)`.
2. `spots.active boolean not null default true`; `active = false` für 5, 7, 9, 19. Platz 24 löschen (hat keinen Besitzer/keine Buchungen; falls doch, schlägt die Migration bewusst fehl).
3. `profiles.seeker boolean not null default false`.
4. `settings.day_rate_cents` auf 300 setzen.
5. **`book_spot`** neu: `p_slots` = `[{"date","hour"}]`; Preis = **Anzahl distinct dates × day_rate_cents** (keine Halbierung). Prüfungen wie bisher (Auth, Besitzer vorhanden, nicht eigener Platz, alle Slots frei und in der Zukunft, Trefferzahl = erwartete Zahl, sonst Rollback).
6. Neu **`claim_spot(p_spot_id int)`** (`security definer`): setzt `owner_id = auth.uid()` nur wenn `owner_id is null` und `active` — race-sicher (0 Treffer ⇒ Exception „Platz schon vergeben"). Execute-Grant nur `authenticated`.
7. RLS unverändert (owner_frees/owner_retracts prüfen weiterhin Besitz; read_all bleibt).

Danach `generate_typescript_types` → `src/lib/database.types.ts`.

## Edge Function `join` (erweitert)

Zusätzliche optionale Felder: `seeker: boolean`, `spot_id: number|null`. Ablauf: Validierung wie bisher → prüft bei `spot_id`, dass der Platz aktiv und besitzerlos ist → User anlegen → `profiles.seeker` setzen → Platz per bedingtem `UPDATE … WHERE owner_id is null AND active` zuordnen. Schlägt die Zuordnung race-bedingt fehl, ist der User trotzdem registriert; Antwort enthält `warning` („Platz inzwischen vergeben — bitte beim Admin melden"), das die Join-Seite anzeigt.

## Frontend

- **`lib/slots.ts`** (TDD): `slotRange` → **`hourRange(from: {date, hour}, to: {date, hour}): Slot[]`** mit `Slot = {date, hour}` (Ende exklusiv); **`priceCents(slots, rate)`** = distinct dates × rate; neu **`hourSpans(slots)`** — fasst Stunden-Zeilen zu Anzeige-Bereichen zusammen („Fr 15:00–24:00, Sa ganztags, So 0:00–18:00"). `fmtEur`, `localDate` bleiben. Alte Halbtags-Typen/-Funktionen entfallen; Tests entsprechend.
- **`components/RangeForm.tsx`**: von-Datum + von-Uhrzeit, bis-Datum + bis-Uhrzeit (native Inputs, volle Stunden), validiert Ende > Anfang. Zeigt bei Buchung den Preis (Tage × 3 €).
- **`pages/Calendar.tsx`** (Startseite): Monatsansicht bleibt. Tag-Klick → freie Plätze des Tages mit freien Stunden-Bereichen + Buchen-Form. Neu: Sektion **„Mein Platz"** — Besitzer geben hier frei (RangeForm) und ziehen ungebuchte Freigaben zurück; wer keinen Platz hat, kann per Dropdown einen besitzerlosen aktiven Platz **eintragen** (`claim_spot`).
- **`pages/Garage.tsx`** (nur Orientierung): gedrehtes Plan-Bild (`public/garagenplan.png`, per `sips -r 180` erzeugt) + kompakte Platz-Übersicht (Nummer, Besitzer, inaktiv-Markierung „Fahrrad/Traktor"). Keine Aktionen, keine Tages-/Halbtags-Navigation mehr.
- **`pages/Ledger.tsx` → Tab „Meine Buchungen"**: (1) meine künftigen Buchungen mit Zeitraum, Kosten und **Storno** (Regel unverändert: bis Vortag, nicht wenn beglichen) — wandert aus der alten Garage-Sidebar hierher; (2) offene Schulden mit Beglichen-Button; (3) Beglichen-Historie.
- **`pages/Join.tsx`**: zusätzlich Checkboxen „Ich suche einen Platz" / „Ich habe einen Platz" mit Platz-Dropdown (besitzerlose aktive Plätze; Laden via anon nicht möglich → die `join`-Function liefert die freie Platzliste über einen GET-Endpoint, gated durch den Invite-Code).
- **`pages/Help.tsx`**: neu geschrieben — Stundenbuchung, Tagespauschale 3 €, Platz eintragen, Sucher, Storno, Begleichen, Plan-Verweis auf Garage-Tab.
- **`pages/Admin.tsx`**: Platz-Zuweisung nur aktive Plätze; User-Liste zeigt „sucht Platz"-Marker; Rest unverändert.
- **`App.tsx`**: Tab-Reihenfolge **Kalender (Start) · Garage · Meine Buchungen · Anleitung · Admin**.

## Preisformel (Client = Server)

`Anzahl distinct Kalendertage der Buchung × day_rate_cents`. Keine Rundungsfrage mehr (keine Division). Cents bleiben Pflicht.

## Tests

- Vitest: `hourRange` (über Tagesgrenzen, Ende exklusiv, Fehlerfälle), `priceCents` (distinct dates), `hourSpans`.
- `scripts/db-smoke.sql` auf Stunden-Modell umstellen (Buchung, Doppelbuchung, Storno, `claim_spot`-Race).

## Bewusste Auslassungen

- Keine Teil-Stornos, keine Minuten-Granularität, keine Überschneidungs-Warnung beim Freigeben (PK verhindert Duplikate ohnehin).
- Kein Entfernen des eigenen Platzes durch den User (macht der Admin).
- Ledger-Beträge aus der Halbtags-Zeit bleiben unverändert stehen.

## Context-Folder

Bei Implementierung: `APPLICATION.md` (neue Business Rules), `ARCHITECTURE.md` (Schema/RPCs/Seiten), `OPEN_QUESTIONS.md` (erledigte/neue Punkte) aktualisieren.
