import { describe, expect, it } from 'vitest'
import { canRetryDirectly, effectiveStatus, needsConfirmRetry } from './jobStatus'

describe('jobStatus', () => {
  const t0 = '2026-10-28T08:00:00Z'; const base = new Date(t0).getTime()
  it('processing kẹt quá 60s thành unknown', () => {
    expect(effectiveStatus('processing', t0, base + 61_000)).toBe('unknown')
    expect(effectiveStatus('processing', t0, base + 5_000)).toBe('processing')
    expect(effectiveStatus('success', t0, base + 999_999)).toBe('success')
  })
  it('chỉ failed/retry_pending được thử lại ngay; unknown/submitted cần xác nhận', () => {
    expect(canRetryDirectly('failed')).toBe(true); expect(canRetryDirectly('unknown')).toBe(false)
    expect(needsConfirmRetry('unknown')).toBe(true); expect(needsConfirmRetry('submitted')).toBe(true); expect(needsConfirmRetry('success')).toBe(false)
  })
})
