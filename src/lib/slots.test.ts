import { describe, expect, it } from 'vitest'
import { fmtEur, localDate, priceCents, slotRange } from './slots'

describe('slotRange', () => {
  it('expands a full single day into am+pm', () => {
    expect(slotRange('2026-08-01', 'am', '2026-08-01', 'pm')).toEqual([
      { date: '2026-08-01', half: 'am' },
      { date: '2026-08-01', half: 'pm' },
    ])
  })

  it('handles pm start and am end across days', () => {
    expect(slotRange('2026-08-01', 'pm', '2026-08-02', 'am')).toEqual([
      { date: '2026-08-01', half: 'pm' },
      { date: '2026-08-02', half: 'am' },
    ])
  })

  it('crosses month boundaries', () => {
    expect(slotRange('2026-08-31', 'pm', '2026-09-01', 'pm')).toEqual([
      { date: '2026-08-31', half: 'pm' },
      { date: '2026-09-01', half: 'am' },
      { date: '2026-09-01', half: 'pm' },
    ])
  })

  it('returns [] for reversed ranges', () => {
    expect(slotRange('2026-08-02', 'am', '2026-08-01', 'am')).toEqual([])
    expect(slotRange('2026-08-01', 'pm', '2026-08-01', 'am')).toEqual([])
  })
})

describe('priceCents', () => {
  it('charges half the day rate per slot', () => {
    expect(priceCents(2, 500)).toBe(500)
    expect(priceCents(3, 500)).toBe(750)
  })
  it('rounds odd rates', () => {
    expect(priceCents(1, 501)).toBe(251)
  })
})

it('fmtEur formats cents as euro', () => {
  expect(fmtEur(750)).toMatch(/7,50/)
})

it('localDate formats local YYYY-MM-DD', () => {
  expect(localDate(new Date(2026, 7, 1))).toBe('2026-08-01')
})
