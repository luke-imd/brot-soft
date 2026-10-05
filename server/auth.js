// Passwort-Hashing (scrypt), Sessions (Cookie mit zufälligem Token, nur der Hash liegt in der DB),
// Passwort-Reset-Tokens.
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

const SESSION_DAYS = 180
const RESET_MINUTES = 60
export const COOKIE = 'garage_sid'

export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored).split('$')
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(expected, actual)
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const inMs = (ms) => new Date(Date.now() + ms).toISOString()

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url')
  db.prepare('insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)')
    .run(sha256(token), userId, inMs(SESSION_DAYS * 864e5))
  return token
}

export function sessionUser(db, token) {
  if (!token) return null
  return db.prepare(`
    select u.id, u.email, u.name, u.is_admin from sessions s join users u on u.id = s.user_id
    where s.token_hash = ? and s.expires_at > ?`).get(sha256(token), new Date().toISOString()) ?? null
}

export function deleteSession(db, token) {
  if (token) db.prepare('delete from sessions where token_hash = ?').run(sha256(token))
}

export function deleteOtherSessions(db, userId, keepToken) {
  db.prepare('delete from sessions where user_id = ? and token_hash <> ?').run(userId, sha256(String(keepToken)))
}

export function createResetToken(db, userId) {
  const token = randomBytes(32).toString('base64url')
  db.prepare('delete from password_resets where user_id = ? or expires_at < ?')
    .run(userId, new Date().toISOString())
  db.prepare('insert into password_resets (token_hash, user_id, expires_at) values (?, ?, ?)')
    .run(sha256(token), userId, inMs(RESET_MINUTES * 6e4))
  return token
}

// Einmal-Token: liefert die user_id und löscht das Token, oder null.
export function consumeResetToken(db, token) {
  const row = db.prepare('select user_id from password_resets where token_hash = ? and expires_at > ?')
    .get(sha256(String(token ?? '')), new Date().toISOString())
  if (!row) return null
  db.prepare('delete from password_resets where user_id = ?').run(row.user_id)
  return row.user_id
}

export const newId = () => randomUUID()

export function parseCookies(header) {
  const out = {}
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function sessionCookie(token, secure) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`]
  if (secure) attrs.push('Secure')
  return attrs.join('; ')
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`

// Einfacher In-Memory-Limiter gegen Passwort-Raten (Login, Reset, Registrierung).
export function rateLimiter({ max, windowMs }) {
  const hits = new Map()
  return (key) => {
    const now = Date.now()
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    list.push(now)
    hits.set(key, list)
    if (hits.size > 10000) hits.clear()
    return list.length <= max
  }
}
