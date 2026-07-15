import type { ChatStreamEventContext } from '../../../types/chat'

import { toRaw } from 'vue'

const OMIT_VALUE = Symbol('omit-context-value')

function sanitizeValue(value: unknown, clones: WeakMap<object, unknown>): unknown {
  if (value === null)
    return value

  if (typeof value === 'function' || typeof value === 'symbol')
    return OMIT_VALUE

  if (typeof value !== 'object')
    return value

  if (clones.has(value))
    return clones.get(value)

  if (Array.isArray(value)) {
    const sanitized: unknown[] = []
    clones.set(value, sanitized)
    for (const item of value) {
      const sanitizedItem = sanitizeValue(item, clones)
      sanitized.push(sanitizedItem === OMIT_VALUE ? undefined : sanitizedItem)
    }
    return sanitized
  }

  if (value instanceof Map) {
    const sanitized = new Map<unknown, unknown>()
    clones.set(value, sanitized)
    for (const [key, nestedValue] of value) {
      const sanitizedKey = sanitizeValue(key, clones)
      if (sanitizedKey === OMIT_VALUE)
        continue

      const sanitizedValue = sanitizeValue(nestedValue, clones)
      sanitized.set(sanitizedKey, sanitizedValue === OMIT_VALUE ? undefined : sanitizedValue)
    }
    return sanitized
  }

  if (value instanceof Set) {
    const sanitized = new Set<unknown>()
    clones.set(value, sanitized)
    for (const item of value) {
      const sanitizedItem = sanitizeValue(item, clones)
      if (sanitizedItem !== OMIT_VALUE)
        sanitized.add(sanitizedItem)
    }
    return sanitized
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype === Object.prototype || prototype === null) {
    const sanitized: Record<string, unknown> = Object.create(prototype)
    clones.set(value, sanitized)
    for (const key of Object.keys(value)) {
      let nestedValue: unknown
      try {
        nestedValue = (value as Record<string, unknown>)[key]
      }
      catch {
        continue
      }

      const sanitizedValue = sanitizeValue(nestedValue, clones)
      if (sanitizedValue !== OMIT_VALUE)
        sanitized[key] = sanitizedValue
    }
    return sanitized
  }

  try {
    structuredClone(value)
    clones.set(value, value)
    return value
  }
  catch {
    return OMIT_VALUE
  }
}

/**
 * Normalizes a value into a structured-clone-safe graph without discarding values
 * that the platform can already clone. Unsupported object properties and Set
 * entries are omitted; unsupported array items and Map values become undefined
 * so positional and key semantics stay intact.
 */
export function sanitizeCloneable<T>(value: T): T | undefined {
  const sanitized = sanitizeValue(value, new WeakMap())
  return (sanitized === OMIT_VALUE ? undefined : sanitized) as T | undefined
}

export function normalizeContextSnapshot<C extends Pick<ChatStreamEventContext, 'contexts'>>(contexts: C): C {
  return {
    ...contexts,
    contexts: Object.fromEntries(
      Object
        .entries(toRaw(contexts.contexts))
        .map(([key, messages]) => [
          key,
          messages.map(message => toRaw(message)),
        ]),
    ),
  }
}

/**
 * Clones a context snapshot through the existing fast path, sanitizing only
 * after the platform reports a non-cloneable value.
 */
export function cloneContextSnapshot<C extends Pick<ChatStreamEventContext, 'contexts'>>(contexts: C): C {
  const normalized = normalizeContextSnapshot(contexts)
  try {
    return structuredClone(normalized)
  }
  catch {
    const sanitized = sanitizeCloneable(normalized)
    if (sanitized === undefined)
      throw new TypeError('Context snapshot could not be sanitized')
    return structuredClone(sanitized)
  }
}
