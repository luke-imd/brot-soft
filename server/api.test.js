// API-Tests gegen einen echten Server mit In-Memory-SQLite (ersetzt scripts/db-smoke.sql).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from './db.js'
import { createApp, today } from './app.js'

const plus = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return today(d) }

let server, base, db
const mails = []

beforeAll(async () => {
  db = openDb(':memory:')
  const mailer = { configured: true, send: async (m) => { mails.push(m) } }
  server = createApp({ db, mailer, appUrl: 'https://garage.test', maxAttempts: 1000 }).listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}/api`
})
afterAll(() => server.close())

// Kleiner Client mit eigenem Cookie-Jar pro User
function client() {
  let cookie = ''
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie && { cookie }), ...(method !== 'GET' && { 'content-type': 'application/json' }) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    return { status: res.status, body: await res.json() }
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
  }
}

const code = () => db.prepare('select code from invites').get().code
const join = (c, name, extra = {}) =>
  c.post('/join', { code: code(), name, email: `${name}@test.local`, password: 'geheim123', ...extra })

describe('Garagen-API', () => {
  const admin = client(), owner = client(), borrower = client(), anon = client()
  let ownerId, borrowerId, bookingId

  it('Registrierung: erster User wird Admin, falscher Code scheitert', async () => {
    expect((await anon.post('/join', { code: 'falsch', list: true })).status).toBe(400)
    expect((await join(admin, 'anna')).body.ok).toBe(true)
    expect((await admin.get('/auth/me')).body).toMatchObject({ name: 'anna', is_admin: true })

    const list = await anon.post('/join', { code: code(), list: true })
    expect(list.body.spots).not.toContain(5) // inaktiv
    expect(list.body.spots).toHaveLength(19)

    const o = await join(owner, 'otto', { spot_id: 1 })
    expect(o.body.warning).toBeUndefined()
    ownerId = (await owner.get('/auth/me')).body.id
    expect((await owner.get('/auth/me')).body.is_admin).toBe(false)
    expect((await join(client(), 'otto')).body.error).toMatch(/schon registriert/)

    const b = await join(borrower, 'berta', { spot_id: 1 })
    expect(b.body.warning).toMatch(/vergeben/)
    borrowerId = (await borrower.get('/auth/me')).body.id
  })

  it('ohne Login kein Zugriff, Nicht-Admin keine Admin-Endpunkte', async () => {
    expect((await anon.get('/spots')).status).toBe(401)
    expect((await borrower.get('/admin/invite')).status).toBe(403)
    expect((await borrower.put('/admin/settings', { day_rate_cents: 1 })).status).toBe(403)
  })

  it('Login/Logout', async () => {
    const c = client()
    expect((await c.post('/auth/login', { email: 'otto@test.local', password: 'falsch' })).status).toBe(401)
    expect((await c.post('/auth/login', { email: 'OTTO@test.local', password: 'geheim123' })).status).toBe(200)
    expect((await c.get('/auth/me')).body.name).toBe('otto')
    await c.post('/auth/logout')
    expect((await c.get('/auth/me')).status).toBe(401)
  })

  it('Freigeben nur für eigenen Platz', async () => {
    const slots = [{ date: plus(1), hour: 10 }, { date: plus(1), hour: 11 }, { date: plus(2), hour: 8 }]
    expect((await borrower.post('/free-slots', { spot_id: 1, slots })).status).toBe(403)
    expect((await owner.post('/free-slots', { spot_id: 1, slots })).status).toBe(200)
    expect((await owner.post('/free-slots', { spot_id: 1, slots })).status).toBe(200) // Duplikate ignoriert
    const free = await borrower.get(`/free-slots?from=${plus(0)}&to=${plus(5)}`)
    expect(free.body).toHaveLength(3)
  })

  it('Buchen: Tagespauschale, Eigenbuchung und Doppelbuchung verboten', async () => {
    const slots = [{ date: plus(1), hour: 10 }, { date: plus(1), hour: 11 }, { date: plus(2), hour: 8 }]
    expect((await owner.post('/bookings', { spot_id: 1, slots })).body.error).toMatch(/Eigenen Platz/)
    expect((await borrower.post('/bookings', { spot_id: 2, slots })).body.error).toMatch(/keinen Besitzer/)

    const r = await borrower.post('/bookings', { spot_id: 1, slots })
    expect(r.status).toBe(200)
    bookingId = r.body.id
    const ledger = (await borrower.get('/ledger')).body
    expect(ledger[0]).toMatchObject({ amount_cents: 600, debtor_id: borrowerId, creditor_id: ownerId })

    const again = await admin.post('/bookings', { spot_id: 1, slots: [slots[0]] })
    expect(again.body.error).toMatch(/nicht alle Stunden/i)
    // fehlgeschlagene Buchung hinterlässt nichts (Rollback)
    expect(db.prepare('select count(*) n from bookings').get().n).toBe(1)

    const mine = (await borrower.get('/my-bookings')).body
    expect(mine).toEqual([{ id: bookingId, spot_id: 1, slots }])
  })

  it('Zurückziehen lässt gebuchte Stunden stehen', async () => {
    await owner.post('/free-slots', { spot_id: 1, slots: [{ date: plus(3), hour: 9 }] })
    await owner.post('/free-slots/retract', { spot_id: 1, slots: [{ date: plus(1), hour: 10 }, { date: plus(3), hour: 9 }] })
    expect(db.prepare('select count(*) n from free_slots').get().n).toBe(3)
  })

  it('Storno nur eigene Buchung, gibt Stunden frei und löscht die Schuld', async () => {
    expect((await owner.post(`/bookings/${bookingId}/cancel`)).body.error).toMatch(/Nicht deine/)
    expect((await borrower.post(`/bookings/${bookingId}/cancel`)).status).toBe(200)
    expect(db.prepare('select count(*) n from free_slots where booking_id is not null').get().n).toBe(0)
    expect(db.prepare('select count(*) n from ledger').get().n).toBe(0)
  })

  it('Begleichen nur Beteiligte; beglichene Schuld blockiert Storno', async () => {
    const r = await borrower.post('/bookings', { spot_id: 1, slots: [{ date: plus(1), hour: 10 }] })
    const id = (await borrower.get('/ledger')).body[0].id
    expect((await admin.post(`/ledger/${id}/settle`)).body.error).toMatch(/Nicht erlaubt/)
    expect((await owner.post(`/ledger/${id}/settle`)).status).toBe(200)
    expect((await owner.post(`/ledger/${id}/settle`)).body.error).toMatch(/schon beglichen/)
    expect((await borrower.get('/ledger')).body[0].settled_by).toBe(ownerId)
    expect((await borrower.post(`/bookings/${r.body.id}/cancel`)).body.error).toMatch(/beglichen/)
  })

  it('Storno am selben Tag nicht mehr möglich', async () => {
    await owner.post('/free-slots', { spot_id: 1, slots: [{ date: plus(0), hour: 23 }] })
    const r = await borrower.post('/bookings', { spot_id: 1, slots: [{ date: plus(0), hour: 23 }] })
    expect((await borrower.post(`/bookings/${r.body.id}/cancel`)).body.error).toMatch(/begonnen/)
  })

  it('Platz beanspruchen: frei ok, vergeben/inaktiv scheitert', async () => {
    expect((await borrower.post('/spots/2/claim')).status).toBe(200)
    expect((await admin.post('/spots/2/claim')).body.error).toMatch(/schon vergeben/)
    expect((await admin.post('/spots/5/claim')).body.error).toMatch(/schon vergeben/)
  })

  it('Admin: Platz zuweisen, Tagessatz, Einladung rotieren, Admin-Recht', async () => {
    expect((await admin.put('/admin/spots/3', { owner_id: borrowerId })).status).toBe(200)
    expect((await admin.put('/admin/spots/5', { owner_id: borrowerId })).status).toBe(400)
    expect((await admin.put('/admin/settings', { day_rate_cents: 250 })).status).toBe(200)
    expect((await owner.get('/settings')).body.day_rate_cents).toBe(250)
    const old = code()
    const fresh = (await admin.post('/admin/invite')).body.code
    expect(fresh).not.toBe(old)
    expect((await anon.post('/join', { code: old, list: true })).status).toBe(400)
    expect((await admin.put(`/admin/profiles/${ownerId}`, { is_admin: true })).status).toBe(200)
    expect((await owner.get('/auth/me')).body.is_admin).toBe(true)
  })

  it('Admin: User löschen nur ohne Historie, sich selbst nie', async () => {
    const me = (await admin.get('/auth/me')).body.id
    expect((await admin.del(`/admin/profiles/${me}`)).body.error).toMatch(/selbst/)
    expect((await admin.del(`/admin/profiles/${borrowerId}`)).body.error).toMatch(/Buchungen/)
    const tmp = client()
    await join(tmp, 'tim', { spot_id: 4 })
    const timId = (await tmp.get('/auth/me')).body.id
    expect((await admin.del(`/admin/profiles/${timId}`)).status).toBe(200)
    expect(db.prepare('select owner_id from spots where id = 4').get().owner_id).toBeNull()
    expect((await tmp.get('/auth/me')).status).toBe(401) // Session mitgelöscht
  })

  it('Passwort vergessen + Reset-Link, Passwort ändern', async () => {
    mails.length = 0
    expect((await anon.post('/auth/forgot', { email: 'gibts@nicht.at' })).status).toBe(200)
    expect(mails).toHaveLength(0)
    await anon.post('/auth/forgot', { email: 'berta@test.local' })
    const token = mails[0].text.match(/reset=([\w-]+)/)[1]
    expect(mails[0].text).toContain('https://garage.test/?reset=')

    const c = client()
    expect((await c.post('/auth/reset', { token, password: 'neu12345' })).status).toBe(200)
    expect((await c.get('/auth/me')).body.name).toBe('berta')
    expect((await c.post('/auth/reset', { token, password: 'nochmal1' })).status).toBe(400) // Einmal-Token
    expect((await borrower.get('/auth/me')).status).toBe(401) // alte Sessions abgemeldet

    expect((await c.post('/auth/password', { password: 'kurz' })).status).toBe(400)
    expect((await c.post('/auth/password', { password: 'final123' })).status).toBe(200)
    expect((await client().post('/auth/login', { email: 'berta@test.local', password: 'final123' })).status).toBe(200)
  })

  it('Zahltag geht an alle', async () => {
    mails.length = 0
    expect((await borrower.post('/admin/zahltag')).status).toBe(401)
    const r = await admin.post('/admin/zahltag')
    expect(r.body.sent).toBe(3)
    expect(mails[0].to).toBe('anna@test.local')
    expect(mails[0].bcc).toEqual(expect.arrayContaining(['otto@test.local', 'berta@test.local']))
    expect(mails[0].bcc).not.toContain('anna@test.local')
  })

  it('Schreibende Requests ohne JSON werden abgelehnt (CSRF)', async () => {
    const res = await fetch(`${base}/spots/6/claim`, { method: 'POST', body: 'x=1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(res.status).toBe(415)
  })
})
