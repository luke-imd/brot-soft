import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './Login'
import Garage from './pages/Garage'
import Calendar from './pages/Calendar'
import Ledger from './pages/Ledger'
import Help from './pages/Help'
import Admin from './pages/Admin'
import Join from './pages/Join'

const TABS = { garage: 'Garage', kalender: 'Kalender', ledger: 'Ledger', anleitung: 'Anleitung', admin: 'Admin' } as const
type Tab = keyof typeof TABS

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) setMsg(error.message)
    else onDone()
  }

  return (
    <form onSubmit={submit} className="card fade-in mb-4 flex flex-wrap items-center gap-3">
      <label className="text-sm font-semibold" htmlFor="new-pw">Neues Passwort</label>
      <input
        id="new-pw"
        type="password"
        required
        minLength={6}
        value={pw}
        onChange={e => setPw(e.target.value)}
        className="input"
      />
      <button className="btn btn-primary">Speichern</button>
      {msg && <p className="w-full text-sm text-red-600">{msg}</p>}
    </form>
  )
}

const joinCode = new URLSearchParams(window.location.search).get('join')

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [tab, setTab] = useState<Tab>('garage')
  // Invite-/Recovery-Link landet mit type=... im URL-Hash -> direkt Passwort setzen lassen
  const [showPw, setShowPw] = useState(() =>
    window.location.hash.includes('type=invite') || window.location.hash.includes('type=recovery'))

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setReady(true))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setIsAdmin(false); return }
    supabase.from('profiles').select('is_admin').eq('id', session.user.id).single()
      .then(({ data }) => setIsAdmin(!!data?.is_admin))
  }, [session])

  if (!ready) return null
  if (joinCode && !session) return <Join code={joinCode} />
  if (!session) return <Login />
  const userId = session.user.id
  const visibleTabs = (Object.keys(TABS) as Tab[]).filter(t => t !== 'admin' || isAdmin)

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5">
          <span className="mr-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-lg font-extrabold text-white">P</span>
            <span className="text-lg font-extrabold tracking-tight">Garage</span>
          </span>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {visibleTabs.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  tab === t ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900'
                }`}
              >
                {TABS[t]}
              </button>
            ))}
          </nav>
          <button
            onClick={() => setShowPw(v => !v)}
            className="ml-auto text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
          >
            Passwort
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
          >
            Logout
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        {showPw && <PasswordForm onDone={() => setShowPw(false)} />}
        <div key={tab} className="fade-in">
          {tab === 'garage' && <Garage userId={userId} />}
          {tab === 'kalender' && <Calendar userId={userId} />}
          {tab === 'ledger' && <Ledger userId={userId} />}
          {tab === 'anleitung' && <Help />}
          {tab === 'admin' && isAdmin && <Admin userId={userId} />}
        </div>
      </main>
    </div>
  )
}
