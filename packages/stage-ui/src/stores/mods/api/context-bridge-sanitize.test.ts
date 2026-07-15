import type { ChatStreamEventContext } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { describe, expect, it } from 'vitest'

import { cloneContextSnapshot } from './context-bridge-sanitize'

function createSnapshot(content: unknown): Pick<ChatStreamEventContext, 'contexts'> {
  return {
    contexts: {
      vision: [{
        id: 'vision-context',
        contextId: 'vision-context',
        strategy: ContextUpdateStrategy.AppendSelf,
        text: 'vision update',
        createdAt: 1,
        content,
      }],
    },
  }
}

function getVisionContent(snapshot: Pick<ChatStreamEventContext, 'contexts'>): Record<string, unknown> {
  const content = snapshot.contexts.vision?.[0]?.content
  if (content === null || typeof content !== 'object' || Array.isArray(content))
    throw new TypeError('Expected vision context content to be an object')
  return content as Record<string, unknown>
}

describe('cloneContextSnapshot', () => {
  // https://github.com/moeru-ai/airi/issues/1909
  it('removes nested non-cloneable context values before structuredClone (Issue #1909)', () => {
    const snapshot = createSnapshot({
      safe: 'kept',
      nested: {
        callback: () => 'not cloneable',
        global: globalThis,
      },
    })

    const cloned = cloneContextSnapshot(snapshot)

    expect(() => structuredClone(cloned)).not.toThrow()
    expect(getVisionContent(cloned)).toEqual({
      safe: 'kept',
      nested: {},
    })
  })

  it('preserves cloneable primitives and built-in values', async () => {
    const shared = { count: 7n }
    const createdAt = new Date('2026-07-15T00:00:00.000Z')
    const matcher = /vision/gi
    const bytes = new Uint8Array([1, 2, 3])
    const buffer = bytes.buffer
    const blob = new Blob(['image metadata'], { type: 'text/plain' })
    const snapshot = createSnapshot({
      valueUndefined: undefined,
      shared,
      createdAt,
      matcher,
      mapping: new Map([['shared', shared]]),
      labels: new Set(['vision', 'image']),
      bytes,
      buffer,
      blob,
      unsafe: () => 'not cloneable',
    })

    const cloned = cloneContextSnapshot(snapshot)
    const content = getVisionContent(cloned)

    expect(Object.hasOwn(content, 'valueUndefined')).toBe(true)
    expect(content.valueUndefined).toBeUndefined()
    expect(Object.hasOwn(content, 'unsafe')).toBe(false)
    expect(content.shared).toEqual({ count: 7n })
    expect(content.createdAt).toEqual(createdAt)
    expect(content.matcher).toEqual(matcher)
    expect(content.mapping).toBeInstanceOf(Map)
    expect((content.mapping as Map<unknown, unknown>).get('shared')).toBe(content.shared)
    expect(content.labels).toEqual(new Set(['vision', 'image']))
    expect(content.bytes).toEqual(bytes)
    expect((content.bytes as Uint8Array).buffer).toBe(content.buffer)
    expect(content.buffer).toEqual(buffer)
    expect(content.blob).toBeInstanceOf(Blob)
    expect(await (content.blob as Blob).text()).toBe('image metadata')
  })

  it('preserves graph identity while replacing unsafe positional values', () => {
    const shared = { label: 'shared' }
    const circular: Record<string, unknown> = { label: 'cycle' }
    circular.self = circular
    const snapshot = createSnapshot({
      sharedA: shared,
      sharedB: shared,
      circular,
      list: [undefined, () => 'not cloneable', 'tail'],
      mapping: new Map<unknown, unknown>([
        ['unsafe-value', () => 'not cloneable'],
        [() => 'unsafe-key', 'dropped'],
      ]),
      labels: new Set([shared, () => 'not cloneable']),
    })

    const cloned = cloneContextSnapshot(snapshot)
    const content = getVisionContent(cloned)
    const list = content.list as unknown[]
    const mapping = content.mapping as Map<unknown, unknown>
    const labels = content.labels as Set<unknown>

    expect(() => structuredClone(cloned)).not.toThrow()
    expect(content.sharedA).toBe(content.sharedB)
    expect((content.circular as Record<string, unknown>).self).toBe(content.circular)
    expect(list).toHaveLength(3)
    expect(Object.hasOwn(list, 0)).toBe(true)
    expect(list[0]).toBeUndefined()
    expect(list[1]).toBeUndefined()
    expect(list[2]).toBe('tail')
    expect(mapping).toEqual(new Map([['unsafe-value', undefined]]))
    expect(labels).toEqual(new Set([content.sharedA]))
  })
})
