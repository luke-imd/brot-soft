import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './Login'
import Garage from './pages/Garage'
import Calendar from './pages/Calendar'
import MyBookings from './pages/MyBookings'
import Help from './pages/Help'
import Admin from './pages/Admin'
import Join from './pages/Join'

const TABS = { kalender: 'Kalender', garage: 'Garage', buchungen: 'Meine Buchungen', anleitung: 'Anleitung', admin: 'Admin' } as const
type Tab = keyof typeof TABS

function PasswordModal({ recovery, onClose }: { recovery: boolean; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw !== pw2) { setMsg('Die Passwörter stimmen nicht überein.'); return }
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) setMsg(error.message)
    else setDone(true)
  }

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-zinc-900/40 p-4" onClick={onClose}>
      <div className="card fade-in w-full max-w-sm space-y-4 p-6" onClick={e => e.stopPropagation()}>
        {done ? (
          <>
            <h2 className="text-lg font-bold tracking-tight">Passwort gespeichert ✓</h2>
            <p className="text-sm text-zinc-600">Ab jetzt loggst du dich mit dem neuen Passwort ein.</p>
            <button onClick={onClose} className="btn btn-primary w-full">Alles klar</button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                {recovery ? 'Neues Passwort setzen' : 'Passwort ändern'}
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                {recovery
                  ? 'Du bist über einen E-Mail-Link hier. Leg jetzt dein Passwort fest.'
                  : 'Mindestens 6 Zeichen. Gilt ab sofort für deinen Login.'}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="new-pw">Neues Passwort</label>
              <input id="new-pw" type="password" required minLength={6} autoFocus
                value={pw} onChange={e => setPw(e.target.value)} className="input w-full" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="new-pw2">Passwort wiederholen</label>
              <input id="new-pw2" type="password" required minLength={6}
                value={pw2} onChange={e => setPw2(e.target.value)} className="input w-full" />
            </div>
            {msg && <p className="text-sm text-red-600">{msg}</p>}
            <div className="flex gap-2">
              {!recovery && (
                <button type="button" onClick={onClose} className="btn btn-outline flex-1">Abbrechen</button>
              )}
              <button className="btn btn-primary flex-1">Speichern</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const joinCode = new URLSearchParams(window.location.search).get('join')

// Invite-/Recovery-Link landet mit type=... im URL-Hash -> direkt Passwort setzen lassen
// (einmal beim Laden auswerten, supabase-js räumt den Hash danach weg)
const fromAuthLink =
  window.location.hash.includes('type=invite') || window.location.hash.includes('type=recovery')

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [userName, setUserName] = useState('')
  const [tab, setTab] = useState<Tab>('kalender')
  const [showPw, setShowPw] = useState(fromAuthLink)
  // "recovery" nur für die automatisch geöffnete Instanz; danach ist es ein normales "Passwort ändern"
  const [recovery, setRecovery] = useState(fromAuthLink)

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setReady(true))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setIsAdmin(false); setUserName(''); return }
    supabase.from('profiles').select('is_admin, name').eq('id', session.user.id).single()
      .then(({ data }) => { setIsAdmin(!!data?.is_admin); setUserName(data?.name ?? '') })
  }, [session])

  if (!ready) return null
  if (joinCode && !session) return <Join code={joinCode} />
  if (!session) return <Login />
  const userId = session.user.id
  const visibleTabs = (Object.keys(TABS) as Tab[]).filter(t => t !== 'admin' || isAdmin)
  const nameWords = userName.trim().split(/\s+/)
  const userInitials = userName
    ? (nameWords.length > 1 ? nameWords[0][0] + nameWords[1][0] : userName.slice(0, 2)).toUpperCase()
    : '·'

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur-[10px]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3.5 gap-y-2 px-5 py-[11px]">
          <span className="mr-1.5 flex items-center gap-[11px]">
            <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-zinc-900 text-[19px] font-extrabold tracking-tight text-white shadow-md">P</span>
            <span className="flex flex-col leading-[1.02]">
              <span className="text-[19px] font-extrabold tracking-tight">Garage</span>
              <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-zinc-400">WG-Parkplätze</span>
            </span>
          </span>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {visibleTabs.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13.5px] font-bold transition-colors ${
                  tab === t ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'
                }`}
              >
                {TABS[t]}
              </button>
            ))}
          </nav>
          <span className="ml-auto flex items-center gap-2">
            <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-zinc-200 text-xs font-extrabold text-zinc-700">
              {userInitials}
            </span>
            <span className="hidden text-sm font-semibold text-zinc-700 sm:inline">{userName}</span>
          </span>
          <button
            onClick={() => setShowPw(true)}
            className="shrink-0 text-sm font-semibold text-zinc-500 transition-colors hover:text-zinc-900"
          >
            Passwort ändern
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-sm font-semibold text-zinc-500 transition-colors hover:text-zinc-900"
          >
            Logout
          </button>
        </div>
      </header>
      {showPw && (
        <PasswordModal
          recovery={recovery}
          onClose={() => { setShowPw(false); setRecovery(false) }}
        />
      )}
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <div key={tab} className="fade-in">
          {tab === 'kalender' && <Calendar userId={userId} />}
          {tab === 'garage' && <Garage userId={userId} />}
          {tab === 'buchungen' && <MyBookings userId={userId} />}
          {tab === 'anleitung' && <Help />}
          {tab === 'admin' && isAdmin && <Admin userId={userId} />}
        </div>
      </main>
    </div>
  )
}
