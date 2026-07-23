# Garagen-Tool

WG-Tool für 24 Garagenplätze: freigeben, buchen, Schulden-Ledger (5 €/Tag, 2,50 €/Halbtag).
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
   (Login geht per Magic Link, rein kommen nur eingeladene User.)
2. **Admin setzen:** Tabelle `profiles` → bei dir `is_admin = true`.
3. **Resend:** Account auf resend.com, API-Key erzeugen, in Supabase unter
   Edge Functions → zahltag → Secrets als `RESEND_API_KEY` hinterlegen.
   Ohne eigene verifizierte Domain versendet Resend nur an die eigene Account-Adresse —
   für den echten Rundversand Domain bei Resend verifizieren und `from:` in
   `supabase/functions/zahltag/index.ts` anpassen.

## Betrieb (Admin-Aufgaben)

- **User einladen:** Authentication → Users → "Invite user" (max. 50).
- **Platz zuordnen:** Tabelle `spots` → `owner_id` des Users eintragen (24 Plätze, 2 Reihen à 12).
- **Tagessatz ändern / Zahltag-Mail:** in der App, Tab "Ledger" → Admin-Bereich.

## Deploy (Vercel)

1. Repo zu GitHub pushen, in Vercel importieren (Framework: Vite, Root: Repo-Root).
2. Env-Vars `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` setzen.
3. Supabase: Authentication → URL Configuration → Site URL auf die Vercel-URL setzen
   (sonst zeigen Magic Links auf localhost).
