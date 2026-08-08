import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type SpotRow = { id: number; owner_id: string | null; active: boolean }

// ponytail: reine Orientierungs-Seite — CSS-Plan nach dem echten Grundriss + Besitzer-Liste,
// keine Aktionen. Gebucht/gebucht-werden passiert im Kalender.
const INACTIVE_LABEL: Record<number, string> = { 5: 'Fahrrad', 7: 'Fahrrad', 9: 'Traktor', 19: 'Fahrrad' }
const INACTIVE_ICON: Record<number, string> = { 5: '🚲', 7: '🚲', 9: '🚜', 19: '🚲' }

// Positionen abgeleitet aus dem Garagenplan (Objekt 2, 19.12.2009), so gedreht,
// dass die Einfahrten unten liegen: links Block 4–1, Mitte 6/8 über 5/7,
// rechts drei Fünfer-Reihen 13–9, 18–14, 23–19.
// Spalten 2, 5 und 8 sind Fahrgassen (Einfahrten) — dort fahren die Autos durch.
const SPOT_POS: Record<number, { col: number; row: number }> = {
  4: { col: 1, row: 1 }, 3: { col: 1, row: 2 }, 2: { col: 1, row: 3 }, 1: { col: 1, row: 4 },
  6: { col: 3, row: 1 }, 8: { col: 4, row: 1 }, 5: { col: 3, row: 2 }, 7: { col: 4, row: 2 },
  13: { col: 6, row: 1 }, 12: { col: 6, row: 2 }, 11: { col: 6, row: 3 }, 10: { col: 6, row: 4 }, 9: { col: 6, row: 5 },
  18: { col: 7, row: 1 }, 17: { col: 7, row: 2 }, 16: { col: 7, row: 3 }, 15: { col: 7, row: 4 }, 14: { col: 7, row: 5 },
  23: { col: 9, row: 1 }, 22: { col: 9, row: 2 }, 21: { col: 9, row: 3 }, 20: { col: 9, row: 4 }, 19: { col: 9, row: 5 },
}

const LANES: { label: string; col: number }[] = [
  { label: 'Einfahrt 1', col: 2 },
  { label: 'Einfahrt 2', col: 5 },
  { label: 'Einfahrt 3', col: 8 },
]

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

  function initials(ownerId: string | null) {
    if (!ownerId) return '—'
    if (ownerId === userId) return 'ICH'
    const name = names.get(ownerId)
    if (!name) return '?'
    const words = name.trim().split(/\s+/)
    return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
  }

  return (
    <div className="space-y-5">
      {loadError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}

      <div>
        <h1 className="text-[27px] font-extrabold leading-tight tracking-tight">Garagenplan</h1>
        <p className="mt-1 text-sm font-medium text-zinc-500">
          Objekt 2 · Gemeinschaft B.R.O.T. Kalksburg — zur Orientierung. Gebucht wird im Kalender.
        </p>
      </div>

      <div className="max-w-xl rounded-2xl bg-gradient-to-b from-zinc-800 to-zinc-900 p-3 shadow-[inset_0_2px_22px_rgba(0,0,0,0.45)]">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-zinc-400">
          Objekt 2 · Ebene 0
        </div>
        {/* ponytail: overflow-x-auto + min-w statt Mobile-Redesign — der Plan braucht ~370px, schmalere Handys scrollen */}
        <div className="mt-2 overflow-x-auto pb-1">
        <div className="grid min-w-96 grid-cols-[1fr_0.6fr_1fr_1fr_0.6fr_1fr_1fr_0.6fr_1fr] gap-1">
          {spots.map(spot => {
            const pos = SPOT_POS[spot.id]
            if (!pos) return null
            const own = spot.owner_id === userId
            return (
              <div key={spot.id} title={`Platz ${spot.id}`}
                style={{ gridColumn: pos.col, gridRow: pos.row }}
                className={`flex h-8 items-center justify-center gap-1 rounded-md text-[11px]
                  ${!spot.active
                    ? 'border border-dashed border-white/20 bg-white/5 text-zinc-500'
                    : own
                      ? 'border border-white/15 bg-blue-500 text-white'
                      : spot.owner_id
                        ? 'border border-white/15 bg-white/10 text-white'
                        : 'border border-dashed border-white/25 bg-white/5 text-zinc-400'}`}>
                <span className="font-extrabold leading-none">{spot.id}</span>
                <span className="text-[8px] font-bold tracking-wide opacity-75">
                  {!spot.active ? INACTIVE_ICON[spot.id] : initials(spot.owner_id)}
                </span>
              </div>
            )
          })}
          {LANES.map(l => (
            <div key={l.label} className="contents">
              <div style={{ gridColumn: l.col, gridRow: '1 / span 5' }}
                className="mx-auto w-0 border-l-2 border-dashed border-white/15" />
              <div style={{ gridColumn: l.col, gridRow: 6 }}
                className="flex justify-center pt-1 text-center text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500">
                <span className="whitespace-nowrap">↓ {l.label}</span>
              </div>
            </div>
          ))}
        </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12.5px] font-semibold text-zinc-600">
        <span className="inline-flex items-center gap-1.5"><span className="h-[11px] w-[11px] rounded-[4px] bg-blue-500" />Dein Platz</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-[11px] w-[11px] rounded-[4px] bg-zinc-400" />Vergeben</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-[11px] w-[11px] rounded-[4px] border-[1.5px] border-dashed border-zinc-400" />Ohne Besitzer</span>
        <span className="inline-flex items-center gap-1.5">🚲/🚜 Nicht buchbar</span>
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
