import { describe, expect, it } from 'vitest'

import { sanitizeCloneable } from './context-bridge-sanitize'

describe('sanitizeCloneable in browser', () => {
  // https://github.com/moeru-ai/airi/issues/1909
  it('removes Window values before structuredClone (Issue #1909)', () => {
    const sanitized = sanitizeCloneable({
      safe: 'kept',
      window,
    })

    expect(sanitized).toEqual({ safe: 'kept' })
    expect(() => structuredClone(sanitized)).not.toThrow()
  })
})
