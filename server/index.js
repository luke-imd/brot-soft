// Einstiegspunkt im Container: DB öffnen, API + Frontend auf PORT ausliefern.
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { openDb } from './db.js'
import { createApp } from './app.js'
import { createMailer } from './mail.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT ?? 3000)
const dbFile = process.env.DB_FILE ?? join(root, 'data', 'garage.db')
const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')

const db = openDb(dbFile)
const mailer = createMailer()
const app = createApp({ db, mailer, appUrl, staticDir: join(root, 'dist') })

app.listen(port, () => {
  console.log(`Garage läuft auf Port ${port} (DB: ${dbFile}, SMTP: ${mailer.configured ? 'an' : 'aus'})`)
  // Erster Start: noch kein User → Einladungs-Link ins Log, der erste Registrierte wird Admin.
  if (db.prepare('select count(*) as n from users').get().n === 0) {
    const { code } = db.prepare('select code from invites where id = 1').get()
    console.log(`Noch keine User. Ersten Admin anlegen über: ${appUrl || `http://<nas>:${port}`}/?join=${code}`)
  }
})
