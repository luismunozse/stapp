import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFormDraft } from '../use-form-draft'

// Mutable session fixture read by the mocked useSession() below -- each
// test sets it to whatever session shape it needs before rendering.
let mockSession: { user: { id: string; organizationId: string } } | null = null

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: mockSession }),
}))

const SESSION_A = { user: { id: 'user-1', organizationId: 'org-1' } }
const SESSION_B = { user: { id: 'user-2', organizationId: 'org-2' } }

describe('useFormDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    mockSession = SESSION_A
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not read or write without a resolved session', () => {
    mockSession = null
    const { result } = renderHook(() =>
      useFormDraft({ feature: 'orden-form', value: { a: 1 } })
    )
    expect(result.current.ready).toBe(false)
    expect(result.current.draft).toBeNull()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(window.localStorage.length).toBe(0)
  })

  it('becomes ready with no draft when storage is empty', () => {
    const { result } = renderHook(() =>
      useFormDraft({ feature: 'orden-form', value: { a: 1 } })
    )
    expect(result.current.ready).toBe(true)
    expect(result.current.draft).toBeNull()
  })

  it('debounces the save and writes a versioned envelope after the delay', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useFormDraft({ feature: 'orden-form', value, debounceMs: 1000 }),
      { initialProps: { value: { a: 1 } } }
    )
    expect(result.current.ready).toBe(true)

    rerender({ value: { a: 2 } })

    // Not written yet -- still inside the debounce window.
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(window.localStorage.length).toBe(0)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    const keys = Object.keys(window.localStorage)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toContain('orden-form')
    expect(keys[0]).toContain('org-1')
    expect(keys[0]).toContain('user-1')

    const stored = JSON.parse(window.localStorage.getItem(keys[0])!)
    expect(stored).toMatchObject({ version: 1, data: { a: 2 } })
    expect(typeof stored.savedAt).toBe('number')
  })

  it('restores a previously saved draft on mount', () => {
    const { result: writer } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', value: { nombre: 'Ana' }, debounceMs: 1000 })
    )
    expect(writer.current.ready).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.length).toBe(1)

    const { result: reader } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', value: { nombre: 'Ana' } })
    )
    expect(reader.current.ready).toBe(true)
    expect(reader.current.draft).toEqual({ nombre: 'Ana' })
  })

  it('discards a draft with an unknown schema version', () => {
    const { result: writer } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', value: { nombre: 'Ana' }, debounceMs: 1000 })
    )
    expect(writer.current.ready).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    const key = Object.keys(window.localStorage)[0]
    const stored = JSON.parse(window.localStorage.getItem(key)!)
    window.localStorage.setItem(key, JSON.stringify({ ...stored, version: 99 }))

    const { result: reader } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', value: { nombre: 'Ana' } })
    )
    expect(reader.current.ready).toBe(true)
    expect(reader.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('discards a draft older than the max age', () => {
    const key = 'draft:v1:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 1, savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, data: { nombre: 'Old' } })
    )

    const { result } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', value: { nombre: '' } })
    )
    expect(result.current.ready).toBe(true)
    expect(result.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('discards malformed JSON without throwing', () => {
    const key = 'draft:v1:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(key, '{not-json')

    const { result } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', value: { nombre: '' } })
    )
    expect(result.current.ready).toBe(true)
    expect(result.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('scopes drafts by organization so different orgs never collide', () => {
    mockSession = SESSION_A
    const { result: orgAResult } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', value: { nombre: 'A' }, debounceMs: 1000 })
    )
    expect(orgAResult.current.ready).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    mockSession = SESSION_B
    const { result: orgBResult } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', value: { nombre: '' } })
    )
    expect(orgBResult.current.ready).toBe(true)
    expect(orgBResult.current.draft).toBeNull()
    expect(window.localStorage.length).toBe(1) // only org-1's draft exists
  })

  it('scopes drafts by recordId so edit and new-record drafts never collide', () => {
    const { result: editResult } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', recordId: 'cli-1', value: { nombre: 'Edit' }, debounceMs: 1000 })
    )
    expect(editResult.current.ready).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    const { result: newResult } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', recordId: null, value: { nombre: '' } })
    )
    expect(newResult.current.ready).toBe(true)
    expect(newResult.current.draft).toBeNull()

    const { result: otherEditResult } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', recordId: 'cli-2', value: { nombre: '' } })
    )
    expect(otherEditResult.current.ready).toBe(true)
    expect(otherEditResult.current.draft).toBeNull()
  })

  it('clearDraft removes the stored entry and resets draft to null', () => {
    const key = 'draft:v1:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 1, savedAt: Date.now(), data: { nombre: 'Ana' } })
    )

    const { result } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', value: { nombre: 'Ana' } })
    )
    expect(result.current.draft).toEqual({ nombre: 'Ana' })

    act(() => {
      result.current.clearDraft()
    })
    expect(result.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('does not read or write while disabled', () => {
    const key = 'draft:v1:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 1, savedAt: Date.now(), data: { nombre: 'Ana' } })
    )

    const { result } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', value: { nombre: 'x' }, enabled: false, debounceMs: 1000 })
    )
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.ready).toBe(false)
    expect(result.current.draft).toBeNull()
    // Existing draft in storage is left untouched (not read, not deleted).
    expect(window.localStorage.getItem(key)).not.toBeNull()
  })

  it('fails silently when localStorage.setItem throws (quota exceeded)', () => {
    const setItemSpy = vi
      .spyOn(window.localStorage.__proto__, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

    const { result } = renderHook(() =>
      useFormDraft({ feature: 'orden-form', value: { a: 1 }, debounceMs: 1000 })
    )
    expect(result.current.ready).toBe(true)

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(1000)
      })
    }).not.toThrow()

    setItemSpy.mockRestore()
  })
})
