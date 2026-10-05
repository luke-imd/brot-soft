// SQLite-Datenbank (eine Datei im Docker-Volume). Nutzt das in Node eingebaute node:sqlite,
// dadurch keine nativen Abhängigkeiten im Container.
import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = `
create table if not exists users (
  id            text primary key,
  email         text not null unique,
  name          text not null,
  password_hash text not null,
  is_admin      integer not null default 0,
  seeker        integer not null default 0,
  created_at    text not null
);

create table if not exists sessions (
  token_hash text primary key,
  user_id    text not null references users(id) on delete cascade,
  expires_at text not null
);

create table if not exists password_resets (
  token_hash text primary key,
  user_id    text not null references users(id) on delete cascade,
  expires_at text not null
);

-- 23 Plätze; 5/7/9/19 inaktiv (Fahrrad/Traktor), dort owner_id dauerhaft null.
create table if not exists spots (
  id       integer primary key,
  owner_id text references users(id),
  active   integer not null default 1
);

-- Single-Row-Tabellen
create table if not exists settings (
  id             integer primary key check (id = 1),
  day_rate_cents integer not null
);
create table if not exists invites (
  id   integer primary key check (id = 1),
  code text not null
);

create table if not exists bookings (
  id          text primary key,
  spot_id     integer not null references spots(id),
  borrower_id text not null references users(id),
  created_at  text not null
);

-- Eine Zeile pro freigegebener Stunde [hour, hour+1). booking_id null = frei.
-- Der PK macht Doppel-Freigabe/Doppelbuchung DB-seitig unmöglich.
create table if not exists free_slots (
  spot_id    integer not null references spots(id),
  date       text not null,
  hour       integer not null check (hour between 0 and 23),
  booking_id text references bookings(id) on delete set null,
  primary key (spot_id, date, hour)
);
create index if not exists free_slots_booking on free_slots(booking_id);

-- Eine Schuldposition pro Buchung; Storno löscht sie via cascade.
create table if not exists ledger (
  id           text primary key,
  booking_id   text unique references bookings(id) on delete cascade,
  debtor_id    text not null references users(id),
  creditor_id  text not null references users(id),
  amount_cents integer not null,
  created_at   text not null,
  settled_at   text,
  settled_by   text references users(id)
);
`

export const INACTIVE_SPOTS = [5, 7, 9, 19]

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;')
  db.exec(SCHEMA)

  // Seed beim ersten Start
  if (!db.prepare('select 1 from spots limit 1').get()) {
    const ins = db.prepare('insert into spots (id, active) values (?, ?)')
    for (let id = 1; id <= 23; id++) ins.run(id, INACTIVE_SPOTS.includes(id) ? 0 : 1)
  }
  db.prepare('insert or ignore into settings (id, day_rate_cents) values (1, 300)').run()
  db.prepare('insert or ignore into invites (id, code) values (1, ?)').run(randomBytes(16).toString('hex'))
  return db
}

// Alles in einer Transaktion; bei Exception Rollback. node:sqlite ist synchron und der Server
// ein einzelner Prozess, dadurch laufen Transaktionen ohnehin nacheinander (race-sicher).
export function tx(db, fn) {
  db.exec('begin immediate')
  try {
    const result = fn()
    db.exec('commit')
    return result
  } catch (err) {
    db.exec('rollback')
    throw err
  }
}
