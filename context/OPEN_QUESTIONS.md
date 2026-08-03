# OPEN QUESTIONS — TODOs, Limitierungen, offene Punkte

## Offene manuelle Setup-Schritte (vor erstem echten Einsatz)

- [x] **Supabase Signups deaktivieren** (Authentication → Sign In/Up) — Registrierung läuft über den `?join=`-Link, nicht über offenen Signup.
- [x] **Admin setzen**: erster Admin gesetzt (`profiles.is_admin = true`). Weitere Admins jetzt in der App (Tab Admin → User verwalten).
- [x] **Plätze zuordnen**: jetzt in der App (Tab Admin → Plätze zuweisen). Bis zugeordnet sind Plätze „ohne Besitzer" und rendern grau.
- [x] **User einladen**: Einladungs-Link in der App (Tab Admin → Einladungs-Link) teilen. Neue User sind sofort drin, keine E-Mail nötig.
- [ ] **Resend einrichten** für den Zahltag-Versand: Account, Domain verifizieren (sonst Testmodus → nur an eigene Adresse), Secret `RESEND_API_KEY` bei der Edge Function hinterlegen, `from:` in `supabase/functions/zahltag/index.ts` auf die eigene Domain setzen.
- [ ] **Zahltag end-to-end testen**: Der Admin-vs-Nicht-Admin-Pfad der `zahltag`-Function ist bislang nur per Code-Review + 403-Curl (unauthentifiziert) verifiziert; der echte Versand + der Admin-Erfolgspfad wurden noch nie ausgeführt (Secret fehlte). Einmal manuell auslösen, sobald `RESEND_API_KEY` gesetzt ist.
- [ ] **Vercel Site URL**: nach Deploy in Supabase Authentication → URL Configuration die Site URL auf die Vercel-Domain setzen (sonst zeigen Invite-/Reset-Links auf localhost).

## Empfehlung: Resend als Custom SMTP

Supabases eingebauter Mailer ist im Free Tier hart limitiert (wenige Auth-Mails/Stunde). Seit der Selbstregistrierung über den `?join=`-Link verschickt die **Registrierung gar keine E-Mails** mehr (`email_confirm: true`) — das Auth-Mail-Limit betrifft nur noch „Passwort vergessen". Für den Zahltag-Versand bleibt Resend nötig; optional Resend zusätzlich als Custom SMTP eintragen (Authentication → Emails → SMTP), dann laufen auch Passwort-Resets über Resend. Braucht dieselbe verifizierte Domain.

## Bekannte kleinere Limitierungen (bewusst akzeptiert für diese Größe)

- **`zahltag`**: Admin bekommt die Mail doppelt (`to` + `bcc`); `listUsers` ist auf 100 gecappt (ok bei ≤50 Usern). Beim nächsten Editieren der Function den Admin aus `bcc` dedupen.
- **Zeitzone**: `current_date` in den RPCs ist UTC, User sind CET/CEST — 1–2 h Slack an den Tagesgrenzen von Buchen/Stornieren. Bei dieser Nutzung irrelevant.
- **Storno-Fenster bleibt tagesbasiert, auch bei Stundenbuchung**: `cancel_booking` prüft weiterhin `min(date) > current_date`, nicht die tatsächliche Uhrzeit. Eine heute (irgendwann) beginnende Buchung gilt schon als „begonnen" und kann ab Tagesbeginn nicht mehr storniert werden. Bei dieser Nutzung akzeptiert, bewusst nicht auf Stunden verfeinert.
- **`join`-`list` gibt Platz-IDs an jeden mit gültigem Invite-Code**: der `{code, list:true}`-Aufruf braucht keine Session, nur den geheimen `invites.code`, und liefert die IDs der besitzerlosen aktiven Plätze fürs Registrierungs-Dropdown. Kein echtes Datenleck (nur IDs, keine Namen/Adressen) und für eine geschlossene WG mit demselben Code-Kreis wie die Registrierung selbst akzeptiert.
- **DB-Smoke-Test** (`scripts/db-smoke.sql`) deckt jetzt Buchung/Doppelbuchung/Storno (inkl. Tagespauschalen-Betrag) und `claim_spot` (Erfolg, schon vergebener Platz, inaktiver Platz) ab, aber weiterhin nicht: `settle_ledger`, RLS-Deny-Pfade. Ergänzen, wenn die Datei ohnehin angefasst wird.
- **Security-Advisor-Warnings**: `handle_new_user()` und `is_admin()` sind an `anon`/`authenticated` EXECUTE-granted (nicht exploitbar — Trigger-Funktion ist per PostgREST nicht aufrufbar, `is_admin` gibt für anon false zurück). Optional per Migration `revoke execute ... from public, anon, authenticated` stummschalten. `book_spot`/`cancel_booking`/`settle_ledger` **und neu `claim_spot`** werden vom Linter ebenfalls als „von `authenticated` ausführbare SECURITY DEFINER Function" gemeldet — das ist beabsichtigt (einziger Schreibweg per Design, siehe RPC-Abschnitt in `ARCHITECTURE.md`), keine neue Risikoklasse, kein Handlungsbedarf.
- **User löschen** (Admin-Seite): geht nur für User **ohne** Buchungen/Ledger-Historie (FK-RESTRICT). Die `delete-user`-Function prüft das vorab und meldet es klar; Platz-Besitz wird beim Löschen automatisch gelöst.
- **Registrierungs-50-User-Deckel ist nicht race-safe** (TOCTOU zwischen Count und Anlegen in `join`): bei gleichzeitigen Registrierungen könnte der Stand minimal über 50 rutschen. Bei einer WG bewusst als harmloser Overshoot akzeptiert; bei Bedarf per DB-Trigger hart machen.
- **Einladungs-Link ist ein geteiltes Geheimnis**: wer ihn hat, kann sich registrieren (bis zum 50-Deckel). Bei Leak in der Admin-Seite „Neuen Link erzeugen". Registrierung prüft die E-Mail nicht auf Besitz (`email_confirm: true`) — bei einer geschlossenen WG akzeptiert.

## Fragen an den Auftraggeber

- Soll der „Zahltag"-Button bleiben, oder verschickt der Admin die eine Mail/Jahr lieber selbst aus dem Mailprogramm (spart die Resend-Domain-Verifizierung)?
