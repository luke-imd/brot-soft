# APPLICATION — Use Cases & Business Rules

Fachliche Regeln der Garagen-Verwaltung. Referenz-Design: `docs/superpowers/specs/2026-07-23-garage-management-design.md`.

## Rollen

- **User**: hat einen Account (`users`), ggf. Besitzer eines Parkplatzes. Sieht alles, bucht fremde Plätze, gibt eigene frei, begleicht Schulden.
- **Admin** (`users.is_admin = 1`): sieht zusätzlich den Tab **Admin** — Plätze zuweisen und aktiv/inaktiv schalten, Einladungs-Link verwalten, User verwalten (Admin-Rechte vergeben, löschen), Tagessatz ändern, Zahltag-Mail auslösen.

Geschlossene Community: kein offener Self-Signup. Registrierung nur über den geheimen Einladungs-Link (`?join=CODE`), den der Admin auf der Admin-Seite erzeugt und teilt. Wer den Link hat, legt selbst Name/E-Mail/Passwort an und ist **sofort drin** (kein Bestätigungs-Mail). Login danach mit E-Mail + Passwort. **Der allererste registrierte User wird automatisch Admin** (Bootstrap; der Einladungs-Link steht beim ersten Start im Container-Log).

## Kern-Workflow

1. **Freigeben** — Der Besitzer trägt im Tab **Kalender** (Startseite) unter „Mein Platz" einen Zeitraum ein („Platz X frei von–bis", stundengenau, volle Stunden). Jede freigegebene Stunde wird eine `free_slots`-Zeile mit `booking_id = null`.
2. **Buchen** — Im Kalender wählt ein anderer User an einem Tag mit freien Plätzen einen Platz + Zeitraum (Datum+Stunde von–bis) und bucht. Erzeugt **atomar** eine `bookings`-Zeile, setzt `booking_id` auf die betroffenen `free_slots`-Stunden und legt **sofort** einen `ledger`-Eintrag an (Schuldner = Bucher, Gläubiger = Besitzer), Betrag = Tagespauschale.
3. **Platz eintragen** — Wer noch keinen Platz hat, kann im Kalender unter „Mein Platz" einen besitzerlosen **aktiven** Platz per `POST /api/spots/:id/claim` beanspruchen („Das ist mein Platz"); race-sicher, erster Klick gewinnt.
4. **Stornieren** — Im Tab **Meine Buchungen**, vor Buchungsbeginn erlaubt: löscht die Buchung, gibt die Slots wieder frei (`free_slots.booking_id` → null) und löscht die Schuld. **Nicht** erlaubt, wenn die Buchung bereits begonnen hat ODER die Schuld schon als beglichen markiert wurde.
5. **Begleichen** — Im Tab **Meine Buchungen**, neben jedem offenen Ledger-Posten ein „Schulden beglichen"-Button. Einseitig: Schuldner **oder** Gläubiger darf klicken, wir glauben ohne Gegenbestätigung. Geloggt via `settled_at` + `settled_by`.
6. **Zahltag** (Admin, ~1×/Jahr) — Button verschickt eine „Heute ist Zahltag"-Mail an alle User (per SMTP, `POST /api/admin/zahltag`).
7. **Registrieren** — Neuer Mitbewohner öffnet den Einladungs-Link, gibt Name/E-Mail/Passwort ein und kreuzt — nur solange es besitzerlose aktive Plätze gibt — optional „Ich habe einen Parkplatz" an (dann Auswahl aus diesen Plätzen; sind alle vergeben, erscheint die Option gar nicht). Der Server (`POST /api/join`) legt den User an (gated durch den geheimen Code + 50-User-Deckel) und ordnet den gewünschten Platz bedingt zu — ist er inzwischen weg, wird der Account trotzdem angelegt und eine `warning` zurückgegeben. Der Server loggt direkt ein, die App kann sofort genutzt werden. Wer schon einen Account hat, kommt über „Bereits einen Account? Anmelden →“ unten auf der Seite zum Login.
8. **Verwalten** (Admin) — Plätze Besitzern zuordnen, Plätze aktivieren/deaktivieren, Einladungs-Link rotieren, User zum Admin machen oder löschen.
9. **Passwort vergessen** — Auf der Login-Seite E-Mail eingeben → Mail mit Link `?reset=TOKEN` (60 min gültig, einmalig). Dort neues Passwort setzen, danach eingeloggt; alle anderen Sessions werden abgemeldet. Braucht SMTP; Notfall ohne Mail: `node server/cli.js set-password`.

## Business Rules (verbindlich)

- **Preis**: Tagessatz `settings.day_rate_cents` (aktuell **300** = 3 €), als **Tagespauschale**: Schuld = `Anzahl distinct gebuchter Kalendertage × Tagessatz`, in Cents. Die Stundenzahl pro Tag ist irrelevant — auch eine Buchung von 1 Stunde kostet die volle Tagespauschale für diesen Tag. Client (`priceCents`) und Server (`POST /api/bookings`) müssen identisch rechnen.
- **Stunden**: `hour` 0–23, ein Slot deckt `[hour, hour+1)` ab (Ende exklusiv, `endHour = 24` heißt „bis Mitternacht"). Ein Zeitraum wird in volle Stunden-Slots zerlegt (`hourRange`).
- **Buchbar** ist nur, was der Besitzer freigegeben hat und was noch nicht gebucht ist und in der Zukunft liegt (`free_slots.date >= heute`, lokales Datum Europe/Vienna).
- **Eigenen Platz buchen** ist verboten (Server antwortet „Eigenen Platz kann man nicht buchen").
- **Platz ohne Besitzer** ist nicht buchbar (Server antwortet „Platz hat keinen Besitzer"). Neu angelegte Plätze haben `owner_id = null`, bis der Admin sie zuordnet oder ein User sie selbst beansprucht.
- **Inaktive Plätze** (`spots.active = false`; beim ersten Start 5, 7, 9, 19 — Fahrrad-/Traktor-Abstellplätze) sind nie buchbar und können auch nicht beansprucht werden; `owner_id` ist bei ihnen `null`. Der Admin schaltet Plätze im Admin-Tab um: **Aktivieren** macht den Platz normal zuweisbar/beanspruchbar; **Deaktivieren** geht nur ohne künftige Buchungen und entfernt Besitzer + künftige offene Freigaben (vergangene Buchungen/Ledger bleiben).
- **`users.seeker`** ist rein informativ (Admin-Badge „sucht Platz") und wird von der Join-Seite nicht gesetzt; `POST /api/join` akzeptiert das Feld weiterhin.
- **Platz beanspruchen** ist race-sicher: das bedingte `UPDATE ... WHERE owner_id is null and active` trifft bei gleichzeitigen Versuchen nur einmal — die zweite Anfrage bekommt 0 Treffer und eine Exception.
- **Ledger entsteht bei Buchung, automatisch** — nicht am Ende des Zeitraums.
- **Doppelbuchung ist DB-seitig unmöglich**: der PK `(spot_id, date, hour)` auf `free_slots` + das bedingte `UPDATE ... WHERE booking_id is null` machen konkurrierende Buchungen race-sicher (die zweite trifft 0 Zeilen und die ganze Transaktion rollt zurück).
- **Storno-Fenster**: nur bis zum Vortag des Buchungsbeginns (`min(date) > heute`) — bleibt tagesbasiert, auch bei stundengenauer Buchung (siehe `OPEN_QUESTIONS.md`).
- **Beglichene Schuld ist geschützt**: eine bereits `settled`-Schuld kann nicht mehr wegstorniert werden (Buchhaltung bleibt erhalten).
- **Transparenz gewollt**: jeder eingeloggte User darf den kompletten Ledger und alle Buchungen lesen. Der Server beschränkt deshalb nur das Schreiben.

## Kalender- und Garage-Anzeige

- **Kalender** (Startseite): Monatsansicht. Jeder Tag mit mindestens einem fremden freien Platz zeigt ein grünes „n frei"-Badge; ist der **eigene** Platz an dem Tag freigegeben, zusätzlich ein blaues „meins"-Badge (Besitzer sehen so ihre eigenen Freigaben). Tag anklicken öffnet die Liste der an diesem Tag freien Plätze; pro Platz werden die freien Stunden zu zusammenhängenden Bereichen gemergt und angezeigt (z. B. „8–12 Uhr, 14–18 Uhr" oder „ganztags"). Der eigene Platz erscheint darin als blaue Info-Zeile („von dir freigegeben") ohne Buchen-Formular — buchbar sind nur fremde Plätze.
- **Garage**: rein statische Orientierungsseite — in CSS nachgebauter Grundriss von Objekt 2 (Kacheln nach dem echten Plan positioniert, Einfahrten unten, Besitzer-Initialen bzw. 🚲/🚜 für inaktive Plätze; auf schmalen Handys horizontal scrollbar) plus Liste „wem gehört welcher Platz". Keine Buchungs- oder Freigabe-Aktionen — die passieren im Kalender.

## Bewusste Auslassungen (YAGNI)

- Keine Gegenbestätigung beim Begleichen.
- Keine automatischen/wiederkehrenden E-Mails, kein Cron — Zahltag ist ein manueller Admin-Klick.
- Keine Übernahme der Supabase-Altdaten beim Umzug auf die NAS (bewusst: Neustart mit leerer DB, alle registrieren sich neu).
- Keine Bezahl-Integration — der Ledger bildet nur ab, gezahlt wird privat.
- Kein UI-Editor fürs Garagen-Layout — die Plan-Positionen sind eine statische Konstante (`SPOT_POS` in `Garage.tsx`), keine Positionsdaten mehr in der DB.
