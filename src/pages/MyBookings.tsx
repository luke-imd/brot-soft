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
      {msg && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</p>}

      <section className="card">
        <h2 className="mb-3 text-lg font-bold tracking-tight">Offene Schulden</h2>
        {open.length === 0 && <p className="text-zinc-500">Keine offenen Schulden. 🎉</p>}
        <ul className="divide-y divide-zinc-100">
          {open.map(r => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
              <div className="min-w-0 flex-1">
                <p>
                  <b>{name(r.debtor_id)}</b> schuldet <b>{name(r.creditor_id)}</b>
                </p>
                <p className="text-xs text-zinc-400">
                  seit {new Date(r.created_at).toLocaleDateString('de-AT')}
                </p>
              </div>
              <span className="font-bold tabular-nums">{fmtEur(r.amount_cents)}</span>
              {(r.debtor_id === userId || r.creditor_id === userId) && (
                <button onClick={() => settle(r.id)}
                  className="btn bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-500">
                  Schulden beglichen
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <details className="card">
        <summary className="cursor-pointer select-none text-lg font-bold tracking-tight">
          Beglichen ({settled.length})
        </summary>
        <ul className="mt-2 divide-y divide-zinc-100">
          {settled.map(r => (
            <li key={r.id} className="py-2 text-sm text-zinc-500">
              {name(r.debtor_id)} → {name(r.creditor_id)}:{' '}
              <span className="font-semibold tabular-nums text-zinc-700">{fmtEur(r.amount_cents)}</span>
              {' — '}beglichen am {new Date(r.settled_at!).toLocaleDateString('de-AT')}
              {' '}durch {name(r.settled_by)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
