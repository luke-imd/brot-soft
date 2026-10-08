// HTTP-API + Auslieferung des gebauten Frontends. Ersetzt Supabase (PostgREST, RLS, RPCs,
// Edge Functions): jede Schreib-Regel, die vorher in RLS-Policies oder security-definer-RPCs
// stand, steht jetzt hier in genau einem Endpunkt.
import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tx } from './db.js'
import {
  COOKIE, clearCookie, consumeResetToken, createResetToken, createSession, deleteOtherSessions, deleteSession,
  hashPassword, newId, parseCookies, rateLimiter, sessionCookie, sessionUser, verifyPassword,
} from './auth.js'

export const MAX_USERS = 50

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const fail = (msg, status = 400) => { throw new HttpError(status, msg) }

// Lokales Datum (Container läuft mit TZ=Europe/Vienna), nicht UTC.
export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const now = () => new Date().toISOString()
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function parseSlots(raw) {
  if (!Array.isArray(raw) || raw.length === 0) fail('Keine Stunden angegeben')
  if (raw.length > 24 * 366) fail('Zeitraum zu lang')
  return raw.map((s) => {
    const hour = Number(s?.hour)
    if (!DATE_RE.test(String(s?.date)) || !Number.isInteger(hour) || hour < 0 || hour > 23) fail('Ungültige Stunde')
    return { date: s.date, hour }
  })
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 6) fail('Passwort muss mindestens 6 Zeichen haben.')
  if (pw.length > 128) fail('Passwort zu lang.')
}

const bool = (r) => r && { ...r, is_admin: !!r.is_admin, seeker: r.seeker === undefined ? undefined : !!r.seeker }

export function createApp({ db, mailer, appUrl, staticDir, maxAttempts = 30 }) {
  const app = express()
  app.set('trust proxy', true) // hinter dem Synology-Reverse-Proxy (HTTPS → HTTP)
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  const loginLimit = rateLimiter({ max: maxAttempts, windowMs: 15 * 60e3 })
  const limit = (req) => { if (!loginLimit(req.ip)) fail('Zu viele Versuche, bitte in ein paar Minuten nochmal.', 429) }
  const baseUrl = (req) => appUrl || `${req.protocol}://${req.get('host')}`

  // CSRF-Schutz: Schreibende Requests müssen JSON sein (Formulare fremder Seiten können das nicht
  // ohne CORS-Preflight senden, und CORS ist nicht freigegeben). Dazu SameSite=Lax-Cookie.
  app.use('/api', (req, _res, next) => {
    if (req.method !== 'GET' && !req.is('application/json')) return next(new HttpError(415, 'JSON erwartet'))
    next()
  })

  // Session auflösen
  app.use('/api', (req, _res, next) => {
    req.token = parseCookies(req.headers.cookie)[COOKIE]
    req.user = bool(sessionUser(db, req.token))
    next()
  })
  const auth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Nicht eingeloggt')))
  const admin = (req, _res, next) =>
    (req.user?.is_admin ? next() : next(new HttpError(req.user ? 403 : 401, 'Nur für Admins')))

  const login = (req, res, userId) => {
    res.setHeader('Set-Cookie', sessionCookie(createSession(db, userId), req.secure))
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  // ---------- Auth ----------

  app.get('/api/auth/me', auth, (req, res) => res.json(req.user))

  app.post('/api/auth/login', (req, res) => {
    limit(req)
    const email = String(req.body.email ?? '').trim().toLowerCase()
    const u = db.prepare('select id, password_hash from users where email = ?').get(email)
    if (!u || !verifyPassword(String(req.body.password ?? ''), u.password_hash)) {
      fail('E-Mail oder Passwort falsch.', 401)
    }
    login(req, res, u.id)
    res.json({ ok: true })
  })

  app.post('/api/auth/logout', (req, res) => {
    deleteSession(db, req.token)
    res.setHeader('Set-Cookie', clearCookie())
    res.json({ ok: true })
  })

  app.post('/api/auth/password', auth, (req, res) => {
    checkPassword(req.body.password)
    db.prepare('update users set password_hash = ? where id = ?').run(hashPassword(req.body.password), req.user.id)
    // alle anderen Sessions abmelden, die aktuelle bleibt
    deleteOtherSessions(db, req.user.id, req.token)
    res.json({ ok: true })
  })

  app.post('/api/auth/forgot', async (req, res) => {
    limit(req)
    if (!mailer.configured) fail('E-Mail-Versand ist nicht eingerichtet — bitte den Admin fragen.', 503)
    const email = String(req.body.email ?? '').trim().toLowerCase()
    const u = db.prepare('select id, name from users where email = ?').get(email)
    // Gleiche Antwort, ob es die Adresse gibt oder nicht (kein Nutzer-Raten).
    if (u) {
      const link = `${baseUrl(req)}/?reset=${createResetToken(db, u.id)}`
      await mailer.send({
        to: email,
        subject: 'Garage: Passwort zurücksetzen',
        text: `Hallo ${u.name},\n\nmit diesem Link setzt du ein neues Passwort (1 Stunde gültig):\n${link}\n\nWenn du das nicht angefordert hast, ignorier diese Mail einfach.`,
      })
    }
    res.json({ ok: true })
  })

  app.post('/api/auth/reset', (req, res) => {
    limit(req)
    checkPassword(req.body.password)
    const userId = consumeResetToken(db, req.body.token)
    if (!userId) fail('Der Link ist ungültig oder abgelaufen. Bitte neu anfordern.')
    db.prepare('update users set password_hash = ? where id = ?').run(hashPassword(req.body.password), userId)
    db.prepare('delete from sessions where user_id = ?').run(userId)
    login(req, res, userId)
    res.json({ ok: true })
  })

  // Selbstregistrierung über den geheimen Einladungs-Link (?join=CODE).
  // { code, list: true } liefert die besitzerlosen aktiven Plätze fürs Dropdown.
  app.post('/api/join', (req, res) => {
    limit(req)
    const b = req.body
    const inv = db.prepare('select code from invites where id = 1').get()
    if (!b.code || String(b.code) !== inv.code) fail('Ungültiger oder abgelaufener Einladungs-Link.')

    if (b.list) {
      const spots = db.prepare('select id from spots where owner_id is null and active = 1 order by id').all()
      return res.json({ ok: true, spots: spots.map((s) => s.id) })
    }

    const name = String(b.name ?? '').trim()
    const email = String(b.email ?? '').trim().toLowerCase()
    const spotId = b.spot_id == null ? null : Number(b.spot_id)
    if (!name || !email || !b.password) fail('Bitte alle Felder ausfüllen.')
    if (name.length > 100 || email.length > 254) fail('Eingabe zu lang.')
    if (!EMAIL_RE.test(email)) fail('Ungültige E-Mail-Adresse.')
    checkPassword(b.password)
    if (spotId !== null && !Number.isInteger(spotId)) fail('Ungültiger Platz.')

    const result = tx(db, () => {
      const count = db.prepare('select count(*) as n from users').get().n
      if (count >= MAX_USERS) fail('Maximale Nutzerzahl erreicht.')
      if (db.prepare('select 1 from users where email = ?').get(email)) fail('Diese E-Mail ist schon registriert.')
      const id = newId()
      // Der allererste User wird automatisch Admin (Bootstrap ohne Datenbank-Zugriff).
      db.prepare(`insert into users (id, email, name, password_hash, is_admin, seeker, created_at)
                  values (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, email, name, hashPassword(b.password), count === 0 ? 1 : 0, b.seeker ? 1 : 0, now())
      let warning
      if (spotId !== null) {
        const r = db.prepare('update spots set owner_id = ? where id = ? and owner_id is null and active = 1').run(id, spotId)
        if (r.changes === 0) {
          warning = 'Dein Wunsch-Platz wurde inzwischen vergeben — du kannst ihn später im Kalender neu wählen oder den Admin fragen.'
        }
      }
      return { id, warning }
    })
    login(req, res, result.id)
    res.json({ ok: true, warning: result.warning })
  })

  // ---------- Lesen (alle eingeloggten User sehen alles — Transparenz gewollt) ----------

  app.get('/api/spots', auth, (_req, res) => {
    res.json(db.prepare('select id, owner_id, active from spots order by id').all().map((s) => ({ ...s, active: !!s.active })))
  })

  app.get('/api/profiles', auth, (_req, res) => {
    res.json(db.prepare('select id, name, is_admin, seeker from users order by name collate nocase').all().map(bool))
  })

  app.get('/api/settings', auth, (_req, res) => {
    res.json(db.prepare('select day_rate_cents from settings where id = 1').get())
  })

  // Freie (ungebuchte) Stunden in einem Datumsbereich
  app.get('/api/free-slots', auth, (req, res) => {
    const { from, to } = req.query
    if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to))) fail('from/to fehlen')
    res.json(db.prepare(`select spot_id, date, hour, booking_id from free_slots
                         where date between ? and ? and booking_id is null`).all(from, to))
  })

  app.get('/api/ledger', auth, (_req, res) => {
    res.json(db.prepare('select * from ledger order by created_at desc').all())
  })

  app.get('/api/my-bookings', auth, (req, res) => {
    const rows = db.prepare(`
      select b.id, b.spot_id, f.date, f.hour from bookings b
      left join free_slots f on f.booking_id = b.id
      where b.borrower_id = ? order by f.date, f.hour`).all(req.user.id)
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, spot_id: r.spot_id, slots: [] })
      if (r.date) map.get(r.id).slots.push({ date: r.date, hour: r.hour })
    }
    res.json([...map.values()])
  })

  // ---------- Schreiben (User) ----------

  const ownSpot = (req, spotId) => {
    const s = db.prepare('select owner_id from spots where id = ?').get(Number(spotId))
    if (!s || s.owner_id !== req.user.id) fail('Das ist nicht dein Platz.', 403)
  }

  // Besitzer gibt Stunden frei; schon vorhandene Stunden werden ignoriert.
  app.post('/api/free-slots', auth, (req, res) => {
    ownSpot(req, req.body.spot_id)
    const slots = parseSlots(req.body.slots)
    const ins = db.prepare('insert or ignore into free_slots (spot_id, date, hour) values (?, ?, ?)')
    tx(db, () => { for (const s of slots) ins.run(Number(req.body.spot_id), s.date, s.hour) })
    res.json({ ok: true })
  })

  // Besitzer zieht Freigabe zurück — nur ungebuchte Stunden.
  app.post('/api/free-slots/retract', auth, (req, res) => {
    ownSpot(req, req.body.spot_id)
    const slots = parseSlots(req.body.slots)
    const del = db.prepare('delete from free_slots where spot_id = ? and date = ? and hour = ? and booking_id is null')
    tx(db, () => { for (const s of slots) del.run(Number(req.body.spot_id), s.date, s.hour) })
    res.json({ ok: true })
  })

  // Buchen: atomar Buchung + Stunden + Ledger. Preis = distinct Kalendertage × Tagessatz.
  app.post('/api/bookings', auth, (req, res) => {
    const spotId = Number(req.body.spot_id)
    const slots = parseSlots(req.body.slots)
    const id = tx(db, () => {
      const spot = db.prepare('select owner_id, active from spots where id = ?').get(spotId)
      if (!spot?.owner_id || !spot.active) fail('Platz hat keinen Besitzer')
      if (spot.owner_id === req.user.id) fail('Eigenen Platz kann man nicht buchen')
      const bookingId = newId()
      db.prepare('insert into bookings (id, spot_id, borrower_id, created_at) values (?, ?, ?, ?)')
        .run(bookingId, spotId, req.user.id, now())
      const upd = db.prepare(`update free_slots set booking_id = ?
        where spot_id = ? and date = ? and hour = ? and booking_id is null and date >= ?`)
      const unique = new Map(slots.map((s) => [`${s.date}|${s.hour}`, s]))
      let count = 0
      for (const s of unique.values()) count += upd.run(bookingId, spotId, s.date, s.hour, today()).changes
      if (count !== unique.size) fail('Nicht alle Stunden sind (mehr) frei')
      const days = new Set(slots.map((s) => s.date)).size
      const rate = db.prepare('select day_rate_cents from settings where id = 1').get().day_rate_cents
      db.prepare(`insert into ledger (id, booking_id, debtor_id, creditor_id, amount_cents, created_at)
                  values (?, ?, ?, ?, ?, ?)`).run(newId(), bookingId, req.user.id, spot.owner_id, days * rate, now())
      return bookingId
    })
    res.json({ id })
  })

  // Storno: nur eigene Buchung, nur bis zum Vortag, nicht wenn die Schuld schon beglichen ist.
  app.post('/api/bookings/:id/cancel', auth, (req, res) => {
    tx(db, () => {
      const b = db.prepare('select borrower_id from bookings where id = ?').get(req.params.id)
      if (!b || b.borrower_id !== req.user.id) fail('Nicht deine Buchung')
      const start = db.prepare('select min(date) as d from free_slots where booking_id = ?').get(req.params.id).d
      if (!start || start <= today()) fail('Buchung hat schon begonnen')
      if (db.prepare('select 1 from ledger where booking_id = ? and settled_at is not null').get(req.params.id)) {
        fail('Schuld wurde schon beglichen — Storno nicht mehr möglich')
      }
      // FKs: free_slots.booking_id -> null (wieder frei), ledger -> cascade gelöscht
      db.prepare('delete from bookings where id = ?').run(req.params.id)
    })
    res.json({ ok: true })
  })

  // Begleichen: Schuldner oder Gläubiger, einseitig, geloggt.
  app.post('/api/ledger/:id/settle', auth, (req, res) => {
    const r = db.prepare(`update ledger set settled_at = ?, settled_by = ?
      where id = ? and settled_at is null and ? in (debtor_id, creditor_id)`)
      .run(now(), req.user.id, req.params.id, req.user.id)
    if (r.changes === 0) fail('Nicht erlaubt oder schon beglichen')
    res.json({ ok: true })
  })

  // Besitzerlosen aktiven Platz für sich beanspruchen (erster Klick gewinnt).
  app.post('/api/spots/:id/claim', auth, (req, res) => {
    const r = db.prepare('update spots set owner_id = ? where id = ? and owner_id is null and active = 1')
      .run(req.user.id, Number(req.params.id))
    if (r.changes === 0) fail('Platz ist schon vergeben oder nicht verfügbar')
    res.json({ ok: true })
  })

  // ---------- Admin ----------

  app.put('/api/admin/spots/:id', admin, (req, res) => {
    const ownerId = req.body.owner_id || null
    if (ownerId && !db.prepare('select 1 from users where id = ?').get(ownerId)) fail('User gibt es nicht')
    const r = db.prepare('update spots set owner_id = ? where id = ? and active = 1').run(ownerId, Number(req.params.id))
    if (r.changes === 0) fail('Platz nicht gefunden oder inaktiv')
    res.json({ ok: true })
  })

  // Platz aktiv/inaktiv schalten (z. B. Fahrrad-/Traktor-Abstellplatz wird wieder Autoplatz).
  // Deaktivieren nur ohne künftige Buchungen; offene Freigaben und der Besitzer werden dabei entfernt.
  app.put('/api/admin/spots/:id/active', admin, (req, res) => {
    const id = Number(req.params.id)
    const active = !!req.body.active
    tx(db, () => {
      if (!db.prepare('select 1 from spots where id = ?').get(id)) fail('Platz nicht gefunden')
      if (!active) {
        const booked = db.prepare('select 1 from free_slots where spot_id = ? and date >= ? and booking_id is not null')
          .get(id, today())
        if (booked) fail('Platz hat noch künftige Buchungen — erst stornieren lassen.')
        db.prepare('delete from free_slots where spot_id = ? and date >= ? and booking_id is null').run(id, today())
        db.prepare('update spots set active = 0, owner_id = null where id = ?').run(id)
      } else {
        db.prepare('update spots set active = 1 where id = ?').run(id)
      }
    })
    res.json({ ok: true })
  })

  app.put('/api/admin/profiles/:id', admin, (req, res) => {
    if (req.params.id === req.user.id) fail('Eigene Admin-Rechte kann man nicht ändern.')
    db.prepare('update users set is_admin = ? where id = ?').run(req.body.is_admin ? 1 : 0, req.params.id)
    res.json({ ok: true })
  })

  app.delete('/api/admin/profiles/:id', admin, (req, res) => {
    const id = req.params.id
    if (id === req.user.id) fail('Du kannst dich nicht selbst löschen.')
    tx(db, () => {
      const used = db.prepare('select 1 from bookings where borrower_id = ?').get(id)
        || db.prepare('select 1 from ledger where ? in (debtor_id, creditor_id, settled_by)').get(id)
      if (used) fail('User hat noch Buchungen oder offene/beglichene Schulden und kann nicht gelöscht werden.')
      db.prepare('update spots set owner_id = null where owner_id = ?').run(id)
      db.prepare('delete from users where id = ?').run(id)
    })
    res.json({ ok: true })
  })

  app.put('/api/admin/settings', admin, (req, res) => {
    const cents = Number(req.body.day_rate_cents)
    if (!Number.isInteger(cents) || cents < 0) fail('Ungültiger Tagessatz.')
    db.prepare('update settings set day_rate_cents = ? where id = 1').run(cents)
    res.json({ ok: true })
  })

  app.get('/api/admin/invite', admin, (_req, res) => {
    res.json(db.prepare('select code from invites where id = 1').get())
  })

  app.post('/api/admin/invite', admin, (_req, res) => {
    const code = newId().replace(/-/g, '')
    db.prepare('update invites set code = ? where id = 1').run(code)
    res.json({ code })
  })

  app.post('/api/admin/zahltag', admin, async (req, res) => {
    if (!mailer.configured) fail('E-Mail-Versand ist nicht eingerichtet (SMTP fehlt in der Container-Config).', 503)
    const others = db.prepare('select email from users where id <> ?').all(req.user.id).map((u) => u.email)
    await mailer.send({
      to: req.user.email,
      bcc: others,
      subject: 'Heute ist Zahltag 💸',
      text: `Hallo!\n\nHeute ist Zahltag: Bitte schaut ins Garagen-Tool (${baseUrl(req)}) und begleicht eure offenen Schulden.`,
    })
    res.json({ sent: others.length + 1 })
  })

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Nicht gefunden')))

  // ---------- Frontend (SPA) ----------
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }))
    app.get('/{*path}', (_req, res) => res.sendFile(join(staticDir, 'index.html')))
  }

  // Fehler → { error }
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültiges JSON' })
    console.error(err)
    res.status(500).json({ error: 'Serverfehler' })
  })

  return app
}
