import { describe, expect, it } from 'vitest'
import { fmtEur, fmtSpan, hourRange, hourSpans, localDate, priceCents } from './slots'

describe('hourRange', () => {
  it('expands a partial single day, end exclusive', () => {
    expect(hourRange('2026-08-01', 11, '2026-08-01', 13)).toEqual([
      { date: '2026-08-01', hour: 11 },
      { date: '2026-08-01', hour: 12 },
    ])
  })

  it('expands a full day with endHour 24', () => {
    const slots = hourRange('2026-08-01', 0, '2026-08-01', 24)
    expect(slots).toHaveLength(24)
    expect(slots[0]).toEqual({ date: '2026-08-01', hour: 0 })
    expect(slots[23]).toEqual({ date: '2026-08-01', hour: 23 })
  })

  it('crosses days and months', () => {
    const slots = hourRange('2026-08-31', 22, '2026-09-01', 2)
    expect(slots).toEqual([
      { date: '2026-08-31', hour: 22 },
      { date: '2026-08-31', hour: 23 },
      { date: '2026-09-01', hour: 0 },
      { date: '2026-09-01', hour: 1 },
    ])
  })

  it('returns [] for reversed ranges', () => {
    expect(hourRange('2026-08-02', 0, '2026-08-01', 24)).toEqual([])
    expect(hourRange('2026-08-01', 13, '2026-08-01', 13)).toEqual([])
    expect(hourRange('2026-08-01', 13, '2026-08-01', 11)).toEqual([])
  })
})

describe('priceCents', () => {
  it('charges the full day rate per distinct date, hours do not matter', () => {
    expect(priceCents(hourRange('2026-08-01', 11, '2026-08-01', 13), 300)).toBe(300)
    expect(priceCents(hourRange('2026-08-01', 15, '2026-08-03', 18), 300)).toBe(900)
  })
  it('returns 0 for empty slots', () => {
    expect(priceCents([], 300)).toBe(0)
  })
})

describe('hourSpans', () => {
  it('merges consecutive hours into [from, to) spans', () => {
    expect(hourSpans([8, 9, 10, 15, 16])).toEqual([[8, 11], [15, 17]])
  })
  it('handles unsorted input and duplicates', () => {
    expect(hourSpans([10, 8, 9, 9])).toEqual([[8, 11]])
  })
  it('returns [] for empty input', () => {
    expect(hourSpans([])).toEqual([])
  })
})

describe('fmtSpan', () => {
  it('formats a span', () => {
    expect(fmtSpan([8, 12])).toBe('8–12 Uhr')
  })
  it('formats the full day as ganztags', () => {
    expect(fmtSpan([0, 24])).toBe('ganztags')
  })
})

it('fmtEur formats cents as euro', () => {
  expect(fmtEur(750)).toMatch(/7,50/)
})

it('localDate formats local YYYY-MM-DD', () => {
  expect(localDate(new Date(2026, 7, 1))).toBe('2026-08-01')
})
