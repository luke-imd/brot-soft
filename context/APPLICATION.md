# APPLICATION — Use Cases & Business Rules

Fachliche Regeln der Garagen-Verwaltung. Referenz-Design: `docs/superpowers/specs/2026-07-23-garage-management-design.md`.

## Rollen

- **User**: hat ein Profil (`profiles`, 1:1 zu Supabase-Auth), ggf. Besitzer von Parkplätzen. Sieht alles, bucht fremde Plätze, gibt eigene frei, begleicht Schulden.
- **Admin** (`profiles.is_admin = true`): zusätzlich Tagessatz ändern, Zahltag-Mail auslösen. User-Einladung & Platz-Zuordnung passieren im **Supabase Studio**, nicht in der App.

Geschlossene Community: kein Self-Signup. Admin lädt per E-Mail ein (Supabase Auth Invite), Login danach mit E-Mail + Passwort.

## Kern-Workflow

1. **Freigeben** — Der Besitzer trägt einen Zeitraum ein („Platz X frei von–bis", halbtagsgenau). Jeder freigegebene Halbtag wird eine `free_slots`-Zeile mit `booking_id = null`.
2. **Buchen** — Ein anderer User wählt einen freien Platz + Zeitraum und bucht. Erzeugt **atomar** eine `bookings`-Zeile, setzt `booking_id` auf den betroffenen `free_slots` und legt **sofort** einen `ledger`-Eintrag an (Schuldner = Bucher, Gläubiger = Besitzer).
3. **Stornieren** — Vor Buchungsbeginn erlaubt: löscht die Buchung, gibt die Slots wieder frei (`free_slots.booking_id` → null) und löscht die Schuld. **Nicht** erlaubt, wenn die Buchung bereits begonnen hat ODER die Schuld schon als beglichen markiert wurde.
4. **Begleichen** — Neben jedem offenen Ledger-Posten ein „Schulden beglichen"-Button. Einseitig: Schuldner **oder** Gläubiger darf klicken, wir glauben ohne Gegenbestätigung. Geloggt via `settled_at` + `settled_by`.
5. **Zahltag** (Admin, ~1×/Jahr) — Button verschickt eine „Heute ist Zahltag"-Mail an alle User (via Resend Edge Function).

## Business Rules (verbindlich)

- **Preis**: Tagessatz `settings.day_rate_cents` (initial **500** = 5 €), ein Halbtag = halber Tagessatz. Schuld = `Anzahl gebuchte Halbtage × Tagessatz / 2`, in Cents, gerundet. Client (`priceCents`) und Server (`book_spot`) müssen identisch rechnen.
- **Halbtage**: `am` (00–12) / `pm` (12–24). Ganzer Tag = beide Slots.
- **Buchbar** ist nur, was der Besitzer freigegeben hat und was noch nicht gebucht ist und in der Zukunft liegt (`free_slots.date >= current_date`).
- **Eigenen Platz buchen** ist verboten (`book_spot` wirft „Eigenen Platz kann man nicht buchen").
- **Platz ohne Besitzer** ist nicht buchbar (`book_spot` wirft „Platz hat keinen Besitzer"). Neu angelegte Plätze haben `owner_id = null`, bis der Admin sie zuordnet.
- **Ledger entsteht bei Buchung, automatisch** — nicht am Ende des Zeitraums.
- **Doppelbuchung ist DB-seitig unmöglich**: der PK `(spot_id, date, half)` auf `free_slots` + das bedingte `UPDATE ... WHERE booking_id is null` machen konkurrierende Buchungen race-sicher (die zweite trifft 0 Zeilen und die ganze Transaktion rollt zurück).
- **Storno-Fenster**: nur bis zum Vortag des Buchungsbeginns (`min(date) > current_date`).
- **Beglichene Schuld ist geschützt**: eine bereits `settled`-Schuld kann nicht mehr wegstorniert werden (Buchhaltung bleibt erhalten) — siehe Migration `...0004`.
- **Transparenz gewollt**: jeder eingeloggte User darf den kompletten Ledger und alle Buchungen lesen. RLS beschränkt deshalb nur das Schreiben.

## Farb-/Status-Logik (Garage-View, pro gewähltem Tag+Halbtag)

- **grau** — kein `free_slots`-Eintrag: der Besitzer nutzt den Platz selbst (bzw. Platz noch keinem Besitzer zugeordnet).
- **grün** — `free_slots`-Eintrag mit `booking_id = null`: frei, buchbar.
- **blau** — von mir gebucht.
- **orange** — von jemand anderem gebucht.

## Bewusste Auslassungen (YAGNI)

- Keine Gegenbestätigung beim Begleichen.
- Keine automatischen/wiederkehrenden E-Mails, kein Cron — Zahltag ist ein manueller Admin-Klick.
- Keine Bezahl-Integration — der Ledger bildet nur ab, gezahlt wird privat.
- Kein UI-Editor fürs Garagen-Layout — Platz-Positionen sind Daten (`spots.grid_row`/`grid_col`).
