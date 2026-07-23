export type Half = 'am' | 'pm'
// Type-Alias, kein Interface: Aliase haben eine implizite Index-Signatur und sind
// dadurch direkt an den generierten `Json`-RPC-Parametertyp zuweisbar.
export type Slot = { date: string; half: Half }

export function localDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function slotRange(
  startDate: string, startHalf: Half, endDate: string, endHalf: Half,
): Slot[] {
  const out: Slot[] = []
  // UTC-Mitternacht als reine Datums-Arithmetik, Ausgabe bleibt der String
  const d = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (d <= end) {
    const date = d.toISOString().slice(0, 10)
    for (const half of ['am', 'pm'] as const) {
      if (date === startDate && half === 'am' && startHalf === 'pm') continue
      if (date === endDate && half === 'pm' && endHalf === 'am') continue
      out.push({ date, half })
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export function priceCents(slotCount: number, dayRateCents: number): number {
  return Math.round((slotCount * dayRateCents) / 2)
}

export function fmtEur(cents: number): string {
  return (cents / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
}
