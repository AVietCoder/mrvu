import { describe, expect, it } from 'vitest'
import { fillDays, fillHours } from './api'

describe('báo cáo: điền khuyết', () => {
  it('fillHours luôn đủ 24 giờ', () => {
    const h = fillHours([{ hour: 9, orders: 2, revenue: 100 }])
    expect(h).toHaveLength(24); expect(h[9].orders).toBe(2); expect(h[10]).toEqual({ hour: 10, orders: 0, revenue: 0 })
  })
  it('fillDays đủ ngày kể cả qua tháng', () => {
    const d = fillDays([{ day: '2026-03-01', orders: 1, revenue: 10 }], '2026-02-27', '2026-03-02')
    expect(d.map((x) => x.day)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
    expect(d[2].revenue).toBe(10); expect(d[0].revenue).toBe(0)
  })
})
