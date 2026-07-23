import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtEur } from '../lib/slots'

type LedgerRow = {
  id: string; debtor_id: string; creditor_id: string; amount_cents: number
  created_at: string; settled_at: string | null; settled_by: string | null
}

export default function Ledger({ userId }: { userId: string }) {
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [l, p] = await Promise.all([
      supabase.from('ledger').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, name'),
    ])
    const err = l.error ?? p.error
    if (err) {
      setMsg(`Fehler beim Laden: ${err.message}`)
      return
    }
    setRows((l.data ?? []) as LedgerRow[])
    setNames(new Map((p.data ?? []).map(x => [x.id, x.name])))
  }, [])

  useEffect(() => { load() }, [load])

  const name = (id: string | null) => (id && names.get(id)) || '?'

  async function settle(id: string) {
    const { error } = await supabase.rpc('settle_ledger', { p_ledger_id: id })
    setMsg(error ? error.message : '')
    await load()
  }

  const open = rows.filter(r => !r.settled_at)
  const settled = rows.filter(r => r.settled_at)

  return (
    <div className="space-y-4">
      {msg && <p className="bg-yellow-50 border border-yellow-300 rounded p-2 text-sm">{msg}</p>}

      <section className="bg-white rounded-xl shadow p-4">
        <h2 className="text-lg font-bold mb-2">Offene Schulden</h2>
        {open.length === 0 && <p className="text-gray-500">Keine offenen Schulden. 🎉</p>}
        <ul className="divide-y">
          {open.map(r => (
            <li key={r.id} className="py-2 flex items-center gap-2">
              <span>
                <b>{name(r.debtor_id)}</b> schuldet <b>{name(r.creditor_id)}</b>{' '}
                {fmtEur(r.amount_cents)}
                <span className="text-gray-400 text-xs ml-2">
                  seit {new Date(r.created_at).toLocaleDateString('de-AT')}
                </span>
              </span>
              {(r.debtor_id === userId || r.creditor_id === userId) && (
                <button onClick={() => settle(r.id)}
                  className="ml-auto bg-green-600 text-white rounded px-3 py-1 text-sm">
                  Schulden beglichen
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <details className="bg-white rounded-xl shadow p-4">
        <summary className="text-lg font-bold cursor-pointer">
          Beglichen ({settled.length})
        </summary>
        <ul className="divide-y mt-2">
          {settled.map(r => (
            <li key={r.id} className="py-2 text-sm text-gray-600">
              {name(r.debtor_id)} → {name(r.creditor_id)}: {fmtEur(r.amount_cents)}
              {' — '}beglichen am {new Date(r.settled_at!).toLocaleDateString('de-AT')}
              {' '}durch {name(r.settled_by)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
