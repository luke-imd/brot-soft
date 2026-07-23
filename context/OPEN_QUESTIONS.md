# OPEN QUESTIONS — TODOs, Limitierungen, offene Punkte

## Offene manuelle Setup-Schritte (vor erstem echten Einsatz)

- [ ] **Supabase Signups deaktivieren** (Authentication → Sign In/Up), damit nur eingeladene User reinkommen.
- [ ] **Admin setzen**: eigenes `profiles.is_admin = true`.
- [ ] **Plätze zuordnen**: `spots.owner_id` je Platz eintragen (24 Plätze, 2×12). Bis dahin sind alle Plätze „ohne Besitzer" und rendern grau.
- [ ] **Resend einrichten** für den Zahltag-Versand: Account, Domain verifizieren (sonst Testmodus → nur an eigene Adresse), Secret `RESEND_API_KEY` bei der Edge Function hinterlegen, `from:` in `supabase/functions/zahltag/index.ts` auf die eigene Domain setzen.
- [ ] **Zahltag end-to-end testen**: Der Admin-vs-Nicht-Admin-Pfad der `zahltag`-Function ist bislang nur per Code-Review + 403-Curl (unauthentifiziert) verifiziert; der echte Versand + der Admin-Erfolgspfad wurden noch nie ausgeführt (Secret fehlte). Einmal manuell auslösen, sobald `RESEND_API_KEY` gesetzt ist.
- [ ] **Vercel Site URL**: nach Deploy in Supabase Authentication → URL Configuration die Site URL auf die Vercel-Domain setzen (sonst zeigen Invite-/Reset-Links auf localhost).

## Empfehlung: Resend als Custom SMTP

Supabases eingebauter Mailer ist im Free Tier hart limitiert (wenige Auth-Mails/Stunde) — beim Einladen von ~50 Usern spürbar. Resend als Custom SMTP in Supabase eintragen (Authentication → Emails → SMTP), dann laufen auch Invites/Resets über Resend (3.000/Monat) und das Stundenlimit lässt sich hochdrehen. Braucht dieselbe verifizierte Domain wie der Zahltag-Versand.

## Bekannte kleinere Limitierungen (bewusst akzeptiert für diese Größe)

- **Kein echter Garagen-Grundriss**: Layout ist ein Platzhalter (2 Reihen à 12) aus `spots.grid_row`/`grid_col`. Echte Positionen einfach in der Tabelle setzen — kein Code nötig.
- **`zahltag`**: Admin bekommt die Mail doppelt (`to` + `bcc`); `listUsers` ist auf 100 gecappt (ok bei ≤50 Usern). Beim nächsten Editieren der Function den Admin aus `bcc` dedupen.
- **Zeitzone**: `current_date` in den RPCs ist UTC, User sind CET/CEST — 1–2 h Slack an den Tagesgrenzen von Buchen/Stornieren. Bei dieser Nutzung irrelevant.
- **DB-Smoke-Test** (`scripts/db-smoke.sql`) deckt Buchung/Doppelbuchung/Storno ab, aber nicht: Halbtags-Betrag, `settle_ledger`, Storno-Fenster-Grenze, RLS-Deny-Pfade. Ergänzen, wenn die Datei ohnehin angefasst wird.
- **Security-Advisor-Warnings**: `handle_new_user()` und `is_admin()` sind an `anon`/`authenticated` EXECUTE-granted (nicht exploitbar — Trigger-Funktion ist per PostgREST nicht aufrufbar, `is_admin` gibt für anon false zurück). Optional per Migration `revoke execute ... from public, anon, authenticated` stummschalten.
- **User löschen**: Ein User mit Platz-Besitz oder Buchungs-/Ledger-Historie lässt sich wegen FK-RESTRICT nicht direkt löschen — Admin-Ops-Stolperstein.

## Fragen an den Auftraggeber

- Tagessatz 5 € ist konfigurierbar (`settings`), kann sich laut Spec noch ändern — aktueller Wert ok?
- Soll der „Zahltag"-Button bleiben, oder verschickt der Admin die eine Mail/Jahr lieber selbst aus dem Mailprogramm (spart die Resend-Domain-Verifizierung)?
