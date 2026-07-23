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
    <form onSubmit={submit} className="bg-white rounded-xl shadow p-4 mb-4 flex flex-wrap items-center gap-2">
      <label className="font-semibold" htmlFor="new-pw">Neues Passwort:</label>
      <input
        id="new-pw"
        type="password"
        required
        minLength={6}
        value={pw}
        onChange={e => setPw(e.target.value)}
        className="border rounded p-1"
      />
      <button className="bg-blue-600 text-white rounded px-3 py-1">Speichern</button>
      {msg && <p className="text-red-600 text-sm w-full">{msg}</p>}
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
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow flex items-center gap-1 px-4 py-2">
        {visibleTabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded ${tab === t ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
          >
            {TABS[t]}
          </button>
        ))}
        <button
          onClick={() => setShowPw(v => !v)}
          className="ml-auto text-sm text-gray-500 hover:text-gray-800"
        >
          Passwort
        </button>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          Logout
        </button>
      </nav>
      <main className="max-w-5xl mx-auto p-4">
        {showPw && <PasswordForm onDone={() => setShowPw(false)} />}
        {tab === 'garage' && <Garage userId={userId} />}
        {tab === 'kalender' && <Calendar userId={userId} />}
        {tab === 'ledger' && <Ledger userId={userId} />}
        {tab === 'anleitung' && <Help />}
        {tab === 'admin' && isAdmin && <Admin userId={userId} />}
      </main>
    </div>
  )
}
