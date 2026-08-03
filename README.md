# Garagen-Tool

WG-Tool für 23 Garagenplätze: freigeben, buchen, Schulden-Ledger (stundengenau, 3 €-Tagespauschale).
Spec: `docs/superpowers/specs/2026-07-23-garage-management-design.md`

## Stack

Supabase (Postgres + Auth + Edge Functions) · React/TS/Tailwind (Vite) · Vercel

## Lokal entwickeln

```bash
npm install
# .env.local anlegen:
#   VITE_SUPABASE_URL=https://dvdasdgduhfalrtcjrdb.supabase.co
#   VITE_SUPABASE_ANON_KEY=<publishable key aus Supabase Studio → Settings → API>
npm run dev
npm test          # Unit-Tests (Slot-/Preis-Logik)
```

DB-Smoke-Test: `scripts/db-smoke.sql` im Supabase SQL Editor ausführen (rollt selbst zurück).

## Einmalige Einrichtung (Supabase Studio)

1. **Signups deaktivieren:** Authentication → Sign In / Up → "Allow new users to sign up" aus.
   (Registrierung läuft über den Einladungs-Link in der App, nicht über offenen Signup.)
2. **Ersten Admin setzen:** Tabelle `profiles` → bei dir `is_admin = true`. Weitere Admins
   danach in der App (Tab "Admin" → User verwalten).
3. **Resend** (nur für den Zahltag-Versand): Account auf resend.com, API-Key erzeugen, in
   Supabase unter Edge Functions → zahltag → Secrets als `RESEND_API_KEY` hinterlegen.
   Ohne eigene verifizierte Domain versendet Resend nur an die eigene Account-Adresse —
   für den echten Rundversand Domain bei Resend verifizieren und `from:` in
   `supabase/functions/zahltag/index.ts` anpassen.

## Betrieb (Admin-Aufgaben) — alles in der App, Tab "Admin"

- **User einladen:** "Einladungs-Link" kopieren und teilen. Wer den Link hat, registriert
  sich selbst (Name/E-Mail/Passwort) und ist sofort drin — keine E-Mail nötig, max. 50 User.
  Bei Verdacht auf Leak: "Neuen Link erzeugen" (alter wird ungültig).
- **Platz zuordnen:** unter "Plätze zuweisen" pro Platz (1–23, außer den inaktiven
  Fahrrad-/Traktorplätzen 5/7/9/19) den Besitzer wählen.
- **User verwalten:** zum Admin machen / Admin entziehen / löschen (Löschen geht nur, wenn der
  User keine Buchungen oder Schulden(-Historie) hat).
- **Tagessatz ändern / Zahltag-Mail:** unter "Tagessatz & Zahltag".

Registrierung verschickt keine E-Mails (`email_confirm: true`). Nur "Passwort vergessen" und
der Zahltag-Versand nutzen E-Mail.

## Deploy (Vercel)

1. Repo zu GitHub pushen, in Vercel importieren (Framework: Vite, Root: Repo-Root).
2. Env-Vars `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` setzen.
3. Supabase: Authentication → URL Configuration → Site URL auf die Vercel-URL setzen
   (sonst zeigen Invite- und Passwort-Reset-Links auf localhost).
