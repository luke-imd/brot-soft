// Notfall-Werkzeug ohne Mail/UI, z. B. per Synology Container Manager → Terminal:
//   node server/cli.js invite                  Einladungs-Link-Code anzeigen
//   node server/cli.js set-password <email> <neues-passwort>
//   node server/cli.js make-admin <email>
//   node server/cli.js backup <datei>          konsistente Kopie der DB (auch im laufenden Betrieb)
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db.js'
import { hashPassword } from './auth.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const db = openDb(process.env.DB_FILE ?? join(root, 'data', 'garage.db'))
const [cmd, email, arg] = process.argv.slice(2)

const user = () => {
  const u = db.prepare('select id, name from users where email = ?').get(String(email ?? '').toLowerCase())
  if (!u) { console.error(`Kein User mit E-Mail ${email}`); process.exit(1) }
  return u
}

if (cmd === 'invite') {
  console.log(db.prepare('select code from invites where id = 1').get().code)
} else if (cmd === 'set-password' && arg) {
  if (arg.length < 6) { console.error('Mindestens 6 Zeichen'); process.exit(1) }
  const u = user()
  db.prepare('update users set password_hash = ? where id = ?').run(hashPassword(arg), u.id)
  db.prepare('delete from sessions where user_id = ?').run(u.id)
  console.log(`Passwort für ${u.name} gesetzt.`)
} else if (cmd === 'make-admin') {
  const u = user()
  db.prepare('update users set is_admin = 1 where id = ?').run(u.id)
  console.log(`${u.name} ist jetzt Admin.`)
} else if (cmd === 'backup' && email) {
  db.exec(`vacuum into '${email.replace(/'/g, "''")}'`)
  console.log(`Backup geschrieben: ${email}`)
} else {
  console.log('Befehle: invite | set-password <email> <passwort> | make-admin <email> | backup <datei>')
  process.exit(1)
}
