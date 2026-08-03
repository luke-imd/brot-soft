// Type-Alias, kein Interface: Aliase haben eine implizite Index-Signatur und sind
// dadurch direkt an den generierten `Json`-RPC-Parametertyp zuweisbar.
export type Slot = { date: string; hour: number }

export function localDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// Durchgehender Zeitraum „von Datum+Stunde bis Datum+Stunde", Ende exklusiv
// (endHour 24 = bis Mitternacht). Eine Slot-Zeile pro voller Stunde.
export function hourRange(
  startDate: string, startHour: number, endDate: string, endHour: number,
): Slot[] {
  const out: Slot[] = []
  // UTC-Mitternacht als reine Datums-Arithmetik, Ausgabe bleibt der String
  const d = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (d <= end) {
    const date = d.toISOString().slice(0, 10)
    const from = date === startDate ? startHour : 0
    const to = date === endDate ? endHour : 24
    for (let h = from; h < to; h++) out.push({ date, hour: h })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Tagespauschale: jeder angefangene Kalendertag zählt voll, Stunden egal.
export function priceCents(slots: Slot[], dayRateCents: number): number {
  return new Set(slots.map(s => s.date)).size * dayRateCents
}

// Stunden-Liste zu zusammenhängenden [von, bis)-Bereichen mergen (für Anzeige).
export function hourSpans(hours: number[]): [number, number][] {
  const sorted = [...new Set(hours)].sort((a, b) => a - b)
  const out: [number, number][] = []
  for (const h of sorted) {
    const last = out[out.length - 1]
    if (last && last[1] === h) last[1] = h + 1
    else out.push([h, h + 1])
  }
  return out
}

export function fmtSpan([from, to]: [number, number]): string {
  return from === 0 && to === 24 ? 'ganztags' : `${from}–${to} Uhr`
}

export function fmtEur(cents: number): string {
  return (cents / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
}
