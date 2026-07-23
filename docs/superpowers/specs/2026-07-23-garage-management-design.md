# Design: Garagenplatz-Management für Wohngemeinschaft

Datum: 2026-07-23

## Zweck

Web-Tool für eine Wohngemeinschaft (max. 50 User, 24 Parkplätze): Besitzer können
ihre Garagenplätze bei Abwesenheit freigeben, andere können sie buchen, und ein
Ledger hält fest, wer wem was schuldet.

## Stack

- **Backend:** Supabase (Postgres, Auth, RLS, eine Edge Function für E-Mail)
- **Frontend:** React + TypeScript + Tailwind, Vite-SPA, gehostet auf Vercel
- Kein eigener API-Server: das SPA spricht via `supabase-js` direkt mit Postgres,
  Zugriffskontrolle über Row Level Security.

## Accounts & Rollen

- Geschlossene Community: Der Admin lädt User per E-Mail-Invite ein (Supabase
  Auth Invite). Keine offene Registrierung.
- `profiles.is_admin` unterscheidet Admin von normalen Usern.
- Der Admin weist jedem Parkplatz seinen Besitzer zu.

## Fachliche Regeln

- Buchungsgranularität: **Halbtage** — jeder Tag hat zwei Slots (AM = 00–12 Uhr,
  PM = 12–24 Uhr). Ein ganzer Tag = beide Slots.
- Preis: Tagessatz (initial 5 €) als globale Admin-Einstellung; ein Halbtag
  kostet den halben Tagessatz (2,50 €).
- Ein Besitzer gibt seinen Platz explizit für einen Zeitraum frei
  („frei von–bis", mit Halbtags-Grenzen). Nur freigegebene, noch nicht gebuchte
  Slots sind buchbar.
- Buchung erzeugt **sofort und automatisch** einen Ledger-Eintrag:
  Schuldner = Bucher, Gläubiger = Platzbesitzer, Betrag = Slots × halber Tagessatz.
- Stornieren vor Buchungsbeginn ist erlaubt und löscht Buchung + Schuld.
- „Schulden beglichen": jeder der beiden Beteiligten kann klicken, wir glauben
  ihm ohne Bestätigung der Gegenseite. Geloggt wird wer und wann
  (`settled_by`, `settled_at`); für den Admin einsichtig.
- „Zahltag"-E-Mail an alle User: manuell vom Admin per Button ausgelöst
  (ca. 1× pro Jahr), versendet über eine Supabase Edge Function + Resend.

## Datenmodell

| Tabelle | Inhalt |
|---|---|
| `profiles` | 1:1 zu `auth.users`; Name, `is_admin` |
| `spots` | 24 Plätze: Nummer, `owner_id`, Position (Reihe/Index) für die Vogelperspektive |
| `availabilities` | Freigabe-Zeiträume je Platz: `spot_id`, Start-/End-Slot |
| `bookings` | Buchung: `spot_id`, `borrower_id`, Zeitraum, Status |
| `booking_slots` | eine Zeile pro Platz + Datum + Halbtag (`am`/`pm`), FK auf `bookings`; **`UNIQUE(spot_id, date, half)`** verhindert Doppelbuchungen auf DB-Ebene |
| `ledger` | pro Buchung: Schuldner, Gläubiger, Betrag, `settled_at`, `settled_by` (die Settled-Felder sind zugleich das Log) |
| `settings` | eine Zeile: Tagessatz |

RLS-Grundsatz: Alle eingeloggten User dürfen alles **lesen** (Transparenz ist
gewollt — jeder sieht, wer wem was schuldet). Schreiben nur:

- Besitzer → eigene Availabilities
- Jeder → eigene Buchungen (anlegen/stornieren)
- Beteiligte (Schuldner oder Gläubiger) → `settled`-Felder ihres Ledger-Eintrags
- Admin → Spots, Settings, Profiles

## UI (3 Ansichten)

1. **Garage** — Vogelperspektive: 2 Reihen à 12 Plätze (SVG/CSS-Grid,
   Layout ist reine Konfiguration; echter Grundriss wird später nachgereicht).
   Farbcodierung pro Platz für den gewählten Tag/Halbtag: vom Besitzer belegt /
   frei / von mir gebucht / von jemand anderem gebucht. Klick auf Platz →
   Details + Buchen bzw. (als Besitzer) Freigeben.
2. **Kalender** — Monatsansicht, pro Tag die Anzahl freier Plätze; Klick auf
   einen Tag listet die freien Plätze, von dort direkt buchen.
3. **Ledger** — Liste offener und beglichener Posten („X schuldet Y n €"),
   für alle sichtbar; „Beglichen"-Button pro offenem Posten. Admin sieht
   zusätzlich Settled-Historie, Tagessatz-Einstellung und den Zahltag-Button.

## Fehlerbehandlung

- Doppelbuchungs-Race: der UNIQUE-Constraint auf `booking_slots` schlägt fehl →
  Frontend zeigt „Platz wurde gerade vergeben" und lädt neu.
- Buchen ist nur möglich, wenn alle gewünschten Slots innerhalb einer Freigabe
  liegen (Prüfung in einer Postgres-Funktion, die Buchung + Slots + Ledger
  atomar in einer Transaktion anlegt).

## Testen

- Kernlogik (Buchung atomar, Doppelbuchung unmöglich, Ledger-Betrag korrekt,
  RLS-Regeln) als pgTAP- oder SQL-Smoke-Tests gegen die lokale Supabase.
- Frontend: Vitest für Preis-/Slot-Berechnung; kein E2E-Framework
  (bewusste Auslassung bei dieser Teamgröße).

## Bewusste Auslassungen (YAGNI)

- Keine Bestätigung der Gegenseite beim Begleichen
- Keine automatischen/wiederkehrenden E-Mails, kein Cron
- Keine Bezahl-Integration — das Ledger bildet nur ab, gezahlt wird privat
- Kein Admin-Editor fürs Garagen-Layout — Positionen sind Konfiguration
