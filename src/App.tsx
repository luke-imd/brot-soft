import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './Login'
import Garage from './pages/Garage'
import Calendar from './pages/Calendar'
import Ledger from './pages/Ledger'

const TABS = { garage: 'Garage', kalender: 'Kalender', ledger: 'Ledger' } as const
type Tab = keyof typeof TABS

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('garage')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) return null
  if (!session) return <Login />
  const userId = session.user.id

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow flex items-center gap-1 px-4 py-2">
        {(Object.keys(TABS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded ${tab === t ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
          >
            {TABS[t]}
          </button>
        ))}
        <button
          onClick={() => supabase.auth.signOut()}
          className="ml-auto text-sm text-gray-500 hover:text-gray-800"
        >
          Logout
        </button>
      </nav>
      <main className="max-w-5xl mx-auto p-4">
        {tab === 'garage' && <Garage userId={userId} />}
        {tab === 'kalender' && <Calendar userId={userId} />}
        {tab === 'ledger' && <Ledger userId={userId} />}
      </main>
    </div>
  )
}
