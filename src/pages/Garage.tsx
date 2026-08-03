import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type SpotRow = { id: number; owner_id: string | null; active: boolean }

// ponytail: reine Orientierungs-Seite — Plan-Bild + Besitzer-Liste, keine Aktionen.
// Gebucht/gebucht-werden passiert im Kalender.
const INACTIVE_LABEL: Record<number, string> = { 5: 'Fahrrad', 7: 'Fahrrad', 9: 'Traktor', 19: 'Fahrrad' }

export default function Garage({ userId }: { userId: string }) {
  const [spots, setSpots] = useState<SpotRow[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('spots').select('id, owner_id, active').order('id'),
      supabase.from('profiles').select('id, name'),
    ]).then(([s, p]) => {
      const err = s.error ?? p.error
      if (err) {
        setLoadError(`Fehler beim Laden: ${err.message}`)
        return
      }
      setSpots((s.data ?? []) as SpotRow[])
      setNames(new Map((p.data ?? []).map(x => [x.id, x.name])))
    })
  }, [])

  return (
    <div className="space-y-5">
      {loadError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}

      <div>
        <h1 className="text-[27px] font-extrabold leading-tight tracking-tight">Garagenplan</h1>
        <p className="mt-1 text-sm font-medium text-zinc-500">
          Objekt 2 · Gemeinschaft B.R.O.T. Kalksburg — zur Orientierung. Gebucht wird im Kalender.
        </p>
      </div>

      <div className="card overflow-x-auto p-3">
        <img src="/garagenplan.png" alt="Garagenplan Objekt 2 mit den Platznummern 1–23"
          className="min-w-[700px] max-w-none sm:min-w-0 sm:max-w-full" />
      </div>

      <div className="card">
        <h2 className="mb-3 text-lg font-bold tracking-tight">Wem gehört welcher Platz?</h2>
        <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {spots.map(spot => (
            <div key={spot.id} className="flex items-baseline gap-2 border-b border-zinc-100 py-1.5 text-sm">
              <span className="w-16 shrink-0 font-bold">Platz {spot.id}</span>
              {!spot.active ? (
                <span className="text-zinc-400">{INACTIVE_LABEL[spot.id] ?? 'nicht verfügbar'}</span>
              ) : spot.owner_id === userId ? (
                <span className="font-semibold text-blue-600">Dein Platz</span>
              ) : spot.owner_id ? (
                <span className="text-zinc-600">{names.get(spot.owner_id) ?? '?'}</span>
              ) : (
                <span className="text-zinc-400">noch kein Besitzer</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
