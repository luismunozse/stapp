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

/**
 * The hook only persists a value once a real user interaction has happened
 * (see the "dirty gate" section of use-form-draft.ts): before that, every
 * value it sees is mount-time prefill / async defaults / a restored draft,
 * and persisting those produced a bogus "draft restored" banner on every
 * reopen. Tests that expect a write must therefore simulate the interaction.
 *
 * The gate only counts interactions that land on a form control, so this
 * dispatches on a real field inside a real <form>, the way a keystroke in one
 * of these screens does.
 */
function userInteracts() {
  const form = document.createElement('form')
  const input = document.createElement('input')
  form.appendChild(input)
  document.body.appendChild(form)
  act(() => {
    input.dispatchEvent(new Event('keydown', { bubbles: true }))
  })
  form.remove()
}

/** Nodos que un test agrega a mano (un formulario vecino, una capa
 *  portaleada). Se registran para limpiarlos siempre, asi un test que falla no
 *  ensucia el DOM de los que siguen. */
const strayNodes: Element[] = []
function appendToBody<T extends Element>(node: T): T {
  document.body.appendChild(node)
  strayNodes.push(node)
  return node
}

/** Una tecla sobre un control que vive adentro de `container`. */
function interactInside(container: Element) {
  const input = document.createElement('input')
  container.appendChild(input)
  act(() => {
    input.dispatchEvent(new Event('keydown', { bubbles: true }))
  })
  input.remove()
}

/** Renders the hook over a mutable `value` prop, reading it through getValue. */
function renderDraft<T>(
  initialValue: T,
  options: {
    feature?: string
    recordId?: string | null
    scope?: string | null
    enabled?: boolean
    debounceMs?: number
    recordUpdatedAt?: string | number | Date | null
    validate?: (data: unknown) => boolean
  } = {}
) {
  const { feature = 'orden-form', debounceMs = 1000, ...rest } = options
  return renderHook(
    ({ value }: { value: T }) =>
      useFormDraft({ feature, debounceMs, getValue: () => value, ...rest }),
    { initialProps: { value: initialValue } }
  )
}

describe('useFormDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    mockSession = SESSION_A
  })

  afterEach(() => {
    while (strayNodes.length) strayNodes.pop()!.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not read or write without a resolved session', () => {
    mockSession = null
    const { result } = renderDraft({ a: 1 })
    expect(result.current.ready).toBe(false)
    expect(result.current.draft).toBeNull()

    userInteracts()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(window.localStorage.length).toBe(0)
  })

  it('becomes ready with no draft when storage is empty', () => {
    const { result } = renderDraft({ a: 1 })
    expect(result.current.ready).toBe(true)
    expect(result.current.draft).toBeNull()
  })

  it('debounces the save and writes a versioned envelope after the delay', () => {
    const { result, rerender } = renderDraft({ a: 1 })
    expect(result.current.ready).toBe(true)

    userInteracts()
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
    expect(stored).toMatchObject({ version: 2, data: { a: 2 } })
    expect(typeof stored.savedAt).toBe('number')
  })

  // --- Dirty gate ----------------------------------------------------------

  it('never persists a form the user has not touched, even when async defaults land', () => {
    const { rerender } = renderDraft({ recibidoPorId: '', nombre: '' })

    // Mount-time async prefill (session-derived defaults, deep-link fetch,
    // a template that resolves late): the value changes, the user did not.
    rerender({ value: { recibidoPorId: 'user-1', nombre: '' } })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(window.localStorage.length).toBe(0)
  })

  it('persists once the user actually modifies the form, keeping the async defaults', () => {
    const { rerender } = renderDraft({ recibidoPorId: '', nombre: '' })
    rerender({ value: { recibidoPorId: 'user-1', nombre: '' } })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(window.localStorage.length).toBe(0)

    userInteracts()
    rerender({ value: { recibidoPorId: 'user-1', nombre: 'Ana' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    const key = Object.keys(window.localStorage)[0]
    expect(JSON.parse(window.localStorage.getItem(key)!).data).toEqual({
      recibidoPorId: 'user-1',
      nombre: 'Ana',
    })
  })

  // --- Debounce starvation (unstable `value` identity) ----------------------

  it('writes while the user keeps typing instead of postponing the save forever', () => {
    const { rerender } = renderDraft({ nombre: '' })
    userInteracts()

    // A keystroke every 300ms for 3s. A debounce that re-arms on every render
    // (the call sites rebuild `value` on each one) would never fire.
    for (let i = 1; i <= 10; i++) {
      rerender({ value: { nombre: 'a'.repeat(i) } })
      act(() => {
        vi.advanceTimersByTime(300)
      })
    }

    const key = Object.keys(window.localStorage)[0]
    expect(key).toBeDefined()
    expect(JSON.parse(window.localStorage.getItem(key)!).data.nombre.length).toBeGreaterThan(0)
  })

  it('re-arms the save after an out-of-render change reported via notifyChange', () => {
    let live = { nombre: '' }
    const { result } = renderHook(() =>
      useFormDraft({ feature: 'orden-form', debounceMs: 1000, getValue: () => live })
    )
    userInteracts()

    // No re-render happens here on purpose: this is the react-hook-form
    // subscription path, which writes into a ref instead of state.
    live = { nombre: 'Ana' }
    act(() => {
      result.current.notifyChange()
      vi.advanceTimersByTime(1000)
    })

    const key = Object.keys(window.localStorage)[0]
    expect(JSON.parse(window.localStorage.getItem(key)!).data).toEqual({ nombre: 'Ana' })
  })

  it('restores a previously saved draft on mount', () => {
    const { rerender } = renderDraft({ nombre: '' }, { feature: 'cliente-form' })
    userInteracts()
    rerender({ value: { nombre: 'Ana' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.length).toBe(1)

    const { result: reader } = renderDraft({ nombre: '' }, { feature: 'cliente-form' })
    expect(reader.current.ready).toBe(true)
    expect(reader.current.draft).toEqual({ nombre: 'Ana' })
  })

  it('discards a draft with an unknown schema version', () => {
    const key = 'draft:v2:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 99, savedAt: Date.now(), data: { nombre: 'Ana' } })
    )

    const { result } = renderDraft({ nombre: '' }, { feature: 'cliente-form' })
    expect(result.current.ready).toBe(true)
    expect(result.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('discards a draft older than the max age', () => {
    const key = 'draft:v2:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, data: { nombre: 'Old' } })
    )

    const { result } = renderDraft({ nombre: '' }, { feature: 'cliente-form' })
    expect(result.current.ready).toBe(true)
    expect(result.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('discards a draft whose shape the caller rejects', () => {
    // DRAFT_SCHEMA_VERSION se mantiene a mano: si alguien cambia la forma de
    // un formulario sin tocarla, el borrador viejo pasa las validaciones del
    // sobre y explota recien cuando el call site lo recorre. El validador del
    // call site es la red que lo agarra antes.
    const key = 'draft:v2:recepcion-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, savedAt: Date.now(), data: { form: {} } })
    )

    const { result } = renderDraft(
      { form: { equipos: [] } },
      {
        feature: 'recepcion-form',
        validate: (data) => Array.isArray((data as any)?.form?.equipos),
      }
    )

    expect(result.current.ready).toBe(true)
    expect(result.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('treats a throwing validator as a corrupt draft', () => {
    const key = 'draft:v2:recepcion-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, savedAt: Date.now(), data: null })
    )

    const { result } = renderDraft(
      { form: { equipos: [] } },
      {
        feature: 'recepcion-form',
        validate: (data) => (data as any).form.equipos.length >= 0,
      }
    )

    expect(result.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('discards malformed JSON without throwing', () => {
    const key = 'draft:v2:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(key, '{not-json')

    const { result } = renderDraft({ nombre: '' }, { feature: 'cliente-form' })
    expect(result.current.ready).toBe(true)
    expect(result.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('scopes drafts by organization so different orgs never collide', () => {
    mockSession = SESSION_A
    const { rerender } = renderDraft({ nombre: '' }, { feature: 'cliente-form' })
    userInteracts()
    rerender({ value: { nombre: 'A' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.length).toBe(1)

    mockSession = SESSION_B
    const { result: orgBResult } = renderDraft({ nombre: '' }, { feature: 'cliente-form' })
    expect(orgBResult.current.ready).toBe(true)
    expect(orgBResult.current.draft).toBeNull()
    expect(window.localStorage.length).toBe(1) // only org-1's draft exists
  })

  it('scopes drafts by recordId so edit and new-record drafts never collide', () => {
    const { rerender } = renderDraft({ nombre: '' }, { feature: 'cliente-form', recordId: 'cli-1' })
    userInteracts()
    rerender({ value: { nombre: 'Edit' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    const { result: newResult } = renderDraft({ nombre: '' }, { feature: 'cliente-form', recordId: null })
    expect(newResult.current.ready).toBe(true)
    expect(newResult.current.draft).toBeNull()

    const { result: otherEditResult } = renderDraft({ nombre: '' }, { feature: 'cliente-form', recordId: 'cli-2' })
    expect(otherEditResult.current.ready).toBe(true)
    expect(otherEditResult.current.draft).toBeNull()
  })

  it('scopes drafts by the extra scope discriminator (deep-link / turno origin)', () => {
    const { rerender } = renderDraft({ dispositivo: '' }, { feature: 'orden-form', scope: 'turno:t-1' })
    userInteracts()
    rerender({ value: { dispositivo: 'Del turno' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(Object.keys(window.localStorage)[0]).toContain('turno:t-1')

    // A walk-in order (no origin) must not inherit the turno draft.
    const { result: walkIn } = renderDraft({ dispositivo: '' }, { feature: 'orden-form' })
    expect(walkIn.current.draft).toBeNull()

    // Neither does an order started from a different turno.
    const { result: otherTurno } = renderDraft({ dispositivo: '' }, { feature: 'orden-form', scope: 'turno:t-2' })
    expect(otherTurno.current.draft).toBeNull()
  })

  // --- Freshness token (edit-mode drafts vs a newer server record) ----------

  it('discards an edit draft when the server record changed after the draft was written', () => {
    const key = 'draft:v2:cliente-form:org-1:user-1:edit:cli-1'
    const savedAt = Date.now() - 60_000
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, savedAt, recordUpdatedAt: savedAt - 1000, data: { nombre: 'Mi borrador' } })
    )

    const { result } = renderDraft(
      { nombre: 'Nombre del server' },
      { feature: 'cliente-form', recordId: 'cli-1', recordUpdatedAt: new Date(Date.now() - 10_000) }
    )
    expect(result.current.ready).toBe(true)
    expect(result.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('keeps an edit draft when the server record has not changed since it was written', () => {
    const key = 'draft:v2:cliente-form:org-1:user-1:edit:cli-1'
    const recordUpdatedAt = Date.now() - 120_000
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: Date.now() - 60_000,
        recordUpdatedAt,
        data: { nombre: 'Mi borrador' },
      })
    )

    const { result } = renderDraft(
      { nombre: 'Nombre del server' },
      { feature: 'cliente-form', recordId: 'cli-1', recordUpdatedAt: new Date(recordUpdatedAt) }
    )
    expect(result.current.draft).toEqual({ nombre: 'Mi borrador' })
  })

  it('keeps the unsaved edits when somebody else saves the record mid-edit', () => {
    // El efecto de la key vuelve a correr cada vez que se mueve el `updatedAt`
    // del registro (un companero guarda la misma ficha y SWR revalida).
    // Reinicializar ahi sobre un formulario que el operador YA edito era la
    // perdida que este hook existe para evitar: la lectura borraba la entrada
    // por desactualizada, la referencia de comparacion pasaba a ser lo que
    // habia escrito sin guardar y el flag de sucio se apagaba, asi que el
    // flush siguiente solo movia la referencia y no volvia a grabar.
    const key = 'draft:v2:cliente-form:org-1:user-1:edit:cli-1'
    const primerUpdatedAt = Date.now() - 120_000

    let live = { nombre: 'Nombre del server' }
    const { result, rerender } = renderHook(
      ({ recordUpdatedAt }: { recordUpdatedAt: number }) =>
        useFormDraft({
          feature: 'cliente-form',
          recordId: 'cli-1',
          debounceMs: 1000,
          getValue: () => live,
          recordUpdatedAt,
        }),
      { initialProps: { recordUpdatedAt: primerUpdatedAt } }
    )

    userInteracts()
    live = { nombre: 'Lo que estoy escribiendo' }
    act(() => {
      result.current.notifyChange()
      vi.advanceTimersByTime(1000)
    })
    expect(JSON.parse(window.localStorage.getItem(key)!).data).toEqual({
      nombre: 'Lo que estoy escribiendo',
    })

    // El guardado del companero: misma key, otro token de frescura.
    const segundoUpdatedAt = Date.now()
    rerender({ recordUpdatedAt: segundoUpdatedAt })
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    const guardado = JSON.parse(window.localStorage.getItem(key)!)
    expect(guardado.data).toEqual({ nombre: 'Lo que estoy escribiendo' })
    // Reestampado contra el registro que el operador tiene en pantalla: con el
    // token viejo la entrada sobrevive pero la proxima apertura la descarta por
    // desactualizada, que es la misma perdida por otro camino.
    expect(guardado.recordUpdatedAt).toBe(segundoUpdatedAt)

    // Y el flag de sucio sigue armado: lo que se escriba despues se sigue
    // grabando sin tener que volver a tocar otro control.
    live = { nombre: 'Y un poco mas' }
    act(() => {
      result.current.notifyChange()
      vi.advanceTimersByTime(1000)
    })
    expect(JSON.parse(window.localStorage.getItem(key)!).data).toEqual({
      nombre: 'Y un poco mas',
    })
  })

  it('keeps a restored draft when the record moves before the user touches anything', () => {
    // El otro lado de la misma condicion. Con el gate de sucio todavia apagado
    // (el operador abrio la ficha, se restauro el borrador y no toco nada), el
    // efecto de la key caia en la re-inicializacion completa: `readDraft`
    // borraba la entrada por desactualizada y `draft` pasaba a null, mientras
    // el dialog seguia mostrando esos valores y el aviso seguia diciendo que se
    // habia restaurado uno. "Guardar" pisaba entonces el guardado del companero
    // con exactamente el contenido que el token de frescura existe para
    // rechazar -- la misma perdida, por otra puerta.
    const key = 'draft:v2:cliente-form:org-1:user-1:edit:cli-1'
    const primerUpdatedAt = Date.now() - 120_000
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: Date.now() - 60_000,
        recordUpdatedAt: primerUpdatedAt,
        data: { nombre: 'Mi borrador' },
      })
    )

    let live = { nombre: 'Nombre del server' }
    const { result, rerender } = renderHook(
      ({ recordUpdatedAt }: { recordUpdatedAt: number }) =>
        useFormDraft({
          feature: 'cliente-form',
          recordId: 'cli-1',
          debounceMs: 1000,
          getValue: () => live,
          recordUpdatedAt,
        }),
      { initialProps: { recordUpdatedAt: primerUpdatedAt } }
    )
    expect(result.current.draft).toEqual({ nombre: 'Mi borrador' })
    expect(result.current.recordChangedWhileEditing).toBe(false)

    // El call site aplica el borrador. El operador todavia no toco nada, asi
    // que la primera ventana sin actividad mueve la referencia encima de el.
    live = { nombre: 'Mi borrador' }
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    // El guardado del companero: misma key, token de frescura nuevo.
    const segundoUpdatedAt = Date.now()
    rerender({ recordUpdatedAt: segundoUpdatedAt })
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    // Nada de lo que hay en pantalla se descarta en silencio...
    expect(result.current.draft).toEqual({ nombre: 'Mi borrador' })
    const guardado = JSON.parse(window.localStorage.getItem(key)!)
    expect(guardado.data).toEqual({ nombre: 'Mi borrador' })
    // ...y la entrada queda estampada contra el registro que el operador tiene
    // delante: con el token viejo sobrevive en disco pero la proxima apertura
    // la descarta por desactualizada, que es la misma perdida diferida.
    expect(guardado.recordUpdatedAt).toBe(segundoUpdatedAt)
    // El conflicto se avisa en vez de resolverlo por el operador.
    expect(result.current.recordChangedWhileEditing).toBe(true)
  })

  it('reports whether the form is holding work, for call sites that re-prefill', () => {
    // Same condition the key effect branches on (interacted || restored),
    // exposed so a call site that re-prefills from the server -- cliente-form
    // when SWR brings a newer record -- decides from this signal instead of a
    // second one of its own. A pristine form has nothing to protect: refreshing
    // it to the colleague's data is safe, and NOT refreshing it means the next
    // submit silently replaces that save.
    const { result } = renderDraft({ nombre: '' }, { feature: 'cliente-form', recordId: 'cli-1' })
    expect(result.current.hasUnsavedWork()).toBe(false)

    userInteracts()
    expect(result.current.hasUnsavedWork()).toBe(true)

    act(() => {
      result.current.clearDraft()
    })
    expect(result.current.hasUnsavedWork()).toBe(false)
  })

  it('reports a restored draft as work even before the operator touches anything', () => {
    const key = 'draft:v2:cliente-form:org-1:user-1:edit:cli-1'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, savedAt: Date.now(), data: { nombre: 'Mi borrador' } })
    )

    const { result } = renderDraft({ nombre: '' }, { feature: 'cliente-form', recordId: 'cli-1' })
    expect(result.current.draft).toEqual({ nombre: 'Mi borrador' })
    // Sigue en pantalla: re-prefillar encima lo borraria sin decirlo.
    expect(result.current.hasUnsavedWork()).toBe(true)
  })

  it('clears the conflict flag once the draft is discarded or submitted', () => {
    const key = 'draft:v2:cliente-form:org-1:user-1:edit:cli-1'
    const primerUpdatedAt = Date.now() - 120_000
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        savedAt: Date.now() - 60_000,
        recordUpdatedAt: primerUpdatedAt,
        data: { nombre: 'Mi borrador' },
      })
    )

    const live = { nombre: 'Mi borrador' }
    const { result, rerender } = renderHook(
      ({ recordUpdatedAt }: { recordUpdatedAt: number }) =>
        useFormDraft({
          feature: 'cliente-form',
          recordId: 'cli-1',
          debounceMs: 1000,
          getValue: () => live,
          recordUpdatedAt,
        }),
      { initialProps: { recordUpdatedAt: primerUpdatedAt } }
    )
    rerender({ recordUpdatedAt: Date.now() })
    expect(result.current.recordChangedWhileEditing).toBe(true)

    // Descartar deja el formulario en la version del companero: el conflicto
    // esta resuelto y el aviso no puede quedarse pegado.
    act(() => {
      result.current.clearDraft()
    })
    expect(result.current.recordChangedWhileEditing).toBe(false)
  })

  it('stores the record freshness token so a later save can be compared against it', () => {
    const recordUpdatedAt = new Date(Date.now() - 120_000)
    const { rerender } = renderDraft(
      { nombre: 'Server' },
      { feature: 'cliente-form', recordId: 'cli-1', recordUpdatedAt }
    )
    userInteracts()
    rerender({ value: { nombre: 'Editado' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    const stored = JSON.parse(
      window.localStorage.getItem('draft:v2:cliente-form:org-1:user-1:edit:cli-1')!
    )
    expect(stored.recordUpdatedAt).toBe(recordUpdatedAt.getTime())
  })

  // --- clearDraft ----------------------------------------------------------

  it('clearDraft removes the stored entry and resets draft to null', () => {
    const key = 'draft:v2:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, savedAt: Date.now(), data: { nombre: 'Ana' } })
    )

    const { result } = renderDraft({ nombre: 'Ana' }, { feature: 'cliente-form' })
    expect(result.current.draft).toEqual({ nombre: 'Ana' })

    act(() => {
      result.current.clearDraft()
    })
    expect(result.current.draft).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('clearDraft cancels a pending write instead of letting it resurrect the draft', () => {
    const { result, rerender } = renderDraft({ nombre: '' }, { feature: 'orden-form' })
    userInteracts()
    rerender({ value: { nombre: 'Orden ya enviada' } })

    // Submit lands mid-debounce: the form stays mounted (success modal).
    act(() => {
      vi.advanceTimersByTime(500)
    })
    act(() => {
      result.current.clearDraft()
    })

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(window.localStorage.length).toBe(0)
  })

  it('stays quiet after clearDraft until the form is dirtied again', () => {
    const { result, rerender } = renderDraft({ nombre: '' }, { feature: 'orden-form' })
    userInteracts()
    rerender({ value: { nombre: 'Orden ya enviada' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.length).toBe(1)

    act(() => {
      result.current.clearDraft()
    })

    // Post-submit re-renders (success modal opening, loading flag flipping)
    // must not re-write the order that was just created.
    for (let i = 0; i < 5; i++) {
      rerender({ value: { nombre: 'Orden ya enviada' } })
      userInteracts()
      act(() => {
        vi.advanceTimersByTime(1000)
      })
    }
    expect(window.localStorage.length).toBe(0)

    // A genuinely new edit starts a new draft again.
    userInteracts()
    rerender({ value: { nombre: 'Orden nueva' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    const key = Object.keys(window.localStorage)[0]
    expect(JSON.parse(window.localStorage.getItem(key)!).data).toEqual({ nombre: 'Orden nueva' })
  })

  // --- Housekeeping --------------------------------------------------------

  it('sweeps drafts of another schema version and expired ones on mount', () => {
    // El barrido esta throttleado (SWEEP_INTERVAL_MS): los tests anteriores de
    // este archivo ya lo corrieron, asi que hay que pasar la ventana para que
    // vuelva a correr.
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000)
    })

    const otraVersion = 'draft:v1:cliente-form:org-1:user-1:new'
    const vencido = 'draft:v2:orden-form:org-1:user-1:new'
    const vigente = 'draft:v2:recepcion-form:org-1:user-1:new'
    window.localStorage.setItem(
      otraVersion,
      JSON.stringify({ version: 1, savedAt: Date.now(), data: { codigoAcceso: '1234' } })
    )
    window.localStorage.setItem(
      vencido,
      JSON.stringify({ version: 2, savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, data: {} })
    )
    window.localStorage.setItem(
      vigente,
      JSON.stringify({ version: 2, savedAt: Date.now(), data: { nombre: 'Ana' } })
    )
    window.localStorage.setItem('otra-app:preferencia', 'no tocar')

    renderDraft({ nombre: '' }, { feature: 'cliente-form' })

    // La key lleva la version adentro, asi que una entrada de otra version ya
    // no la alcanza ninguna lectura: sin barrido queda para siempre.
    expect(window.localStorage.getItem(otraVersion)).toBeNull()
    expect(window.localStorage.getItem(vencido)).toBeNull()
    expect(window.localStorage.getItem(vigente)).not.toBeNull()
    expect(window.localStorage.getItem('otra-app:preferencia')).toBe('no tocar')
  })

  it('re-captures the baseline after the form resets, not before it', () => {
    // Los tres call sites llaman clearDraft() ANTES de resetear el formulario
    // ("Descartar"). Si la referencia se toma en ese instante, queda apuntando
    // al borrador descartado: el primer click despues del reset graba un
    // borrador de los valores en blanco y la proxima apertura anuncia un
    // borrador restaurado que no restaura nada.
    const { result, rerender } = renderDraft({ nombre: '' }, { feature: 'cliente-form' })
    userInteracts()
    rerender({ value: { nombre: 'Editado' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.length).toBe(1)

    act(() => {
      result.current.clearDraft()
    })
    // El reset del call site, que llega en el render siguiente.
    rerender({ value: { nombre: '' } })

    userInteracts()
    rerender({ value: { nombre: '' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.length).toBe(0)
  })

  it('keeps a restored draft when the form still equals it', () => {
    // El borrador restaurado ES el estado previo a cualquier interaccion, asi
    // que la primera ventana de debounce sin actividad mueve la referencia
    // encima de el. A partir de ahi, "el formulario es igual a la referencia"
    // dejaba de significar "el usuario deshizo lo que escribio" y pasaba a
    // significar "el formulario sigue igual al borrador que acaba de
    // restaurar": un click en Siguiente, abrir y cerrar un select, o cualquier
    // click dentro de un dialogo borraba el borrador mientras el aviso todavia
    // decia que se habia restaurado.
    const key = 'draft:v2:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, savedAt: Date.now(), data: { nombre: 'Ana' } })
    )

    const { result, rerender } = renderDraft({ nombre: '' }, { feature: 'cliente-form' })
    expect(result.current.draft).toEqual({ nombre: 'Ana' })

    // El call site aplica el borrador: el formulario ya vale lo restaurado.
    rerender({ value: { nombre: 'Ana' } })
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    // Interaccion que no cambia nada (Siguiente, un select que se abre y se
    // cierra, un accesorio que se marca y se desmarca).
    userInteracts()
    rerender({ value: { nombre: 'Ana' } })
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(window.localStorage.getItem(key)).not.toBeNull()
    expect(JSON.parse(window.localStorage.getItem(key)!).data).toEqual({ nombre: 'Ana' })
  })

  it('removes the entry when the user reverts after discarding a restored draft', () => {
    // El descarte deja el formulario en blanco y sin borrador: de ahi en mas
    // vuelve a valer la regla de arriba (escribir y deshacer borra la entrada),
    // porque ya no hay ningun borrador restaurado que proteger.
    const key = 'draft:v2:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, savedAt: Date.now(), data: { nombre: 'Ana' } })
    )

    // Los call sites limpian y resetean en el mismo handler, asi que el valor
    // ya es el reseteado en el render que sigue a clearDraft: se modela con una
    // referencia mutable en vez de con rerender, que los separa en dos renders.
    let live = { nombre: '' }
    const { result } = renderHook(() =>
      useFormDraft({ feature: 'cliente-form', debounceMs: 1000, getValue: () => live })
    )
    expect(result.current.draft).toEqual({ nombre: 'Ana' })

    // El call site aplica el borrador y la primera ventana sin interaccion
    // mueve la referencia encima de el.
    live = { nombre: 'Ana' }
    act(() => {
      result.current.notifyChange()
      vi.advanceTimersByTime(2000)
    })

    act(() => {
      live = { nombre: '' }
      result.current.clearDraft()
    })

    userInteracts()
    live = { nombre: 'Otra cosa' }
    act(() => {
      result.current.notifyChange()
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.getItem(key)).not.toBeNull()

    live = { nombre: '' }
    act(() => {
      result.current.notifyChange()
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('removes the stored draft when the form goes back to its baseline', () => {
    const { rerender } = renderDraft({ nombre: '' }, { feature: 'cliente-form' })
    userInteracts()
    rerender({ value: { nombre: 'Ana' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.length).toBe(1)

    // Deshacer hasta el valor original: sin borrar la entrada, la proxima
    // apertura restaura la edicion intermedia que el usuario ya descarto.
    rerender({ value: { nombre: '' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.length).toBe(0)
  })

  it('ignores interactions that do not land on a form control', () => {
    const { rerender } = renderDraft({ nombre: '' })

    // Un click en el layout (sidebar, backdrop, una tarjeta) no es una edicion
    // del formulario: si lo fuera, cualquier prefill que resuelva despues
    // pasaria por cambio del usuario y se grabaria un borrador de defaults.
    const chrome = document.createElement('div')
    document.body.appendChild(chrome)
    act(() => {
      chrome.dispatchEvent(new Event('click', { bubbles: true }))
    })
    rerender({ value: { nombre: 'prefill asincronico' } })
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(window.localStorage.length).toBe(0)
    chrome.remove()
  })

  it('ignores typing in another form nested inside this one', () => {
    // ClienteSelector monta ClienteForm -- su propio <form>, adentro de un
    // dialog que Radix portalea al final de <body> -- dentro de OrdenForm y de
    // RecepcionForm. Escribir ahi marcaba como sucio al formulario PADRE, asi
    // que cualquier prefill que resolviera en el medio (el turno, el
    // deep-link) se persistia como borrador de un formulario que nadie toco y
    // la apertura siguiente anunciaba un borrador restaurado que no era tal.
    const ownForm = appendToBody(document.createElement('form'))
    const nestedDialog = appendToBody(document.createElement('div'))
    nestedDialog.setAttribute('role', 'dialog')
    const nestedForm = nestedDialog.appendChild(document.createElement('form'))

    let live = { nombre: '' }
    const { result } = renderHook(() =>
      useFormDraft({
        feature: 'orden-form',
        debounceMs: 1000,
        getValue: () => live,
        rootRef: { current: ownForm },
      })
    )

    interactInside(nestedForm)
    live = { nombre: 'prefill del turno' }
    act(() => {
      result.current.notifyChange()
      vi.advanceTimersByTime(2000)
    })
    expect(window.localStorage.length).toBe(0)

    // El formulario propio si cuenta.
    interactInside(ownForm)
    live = { nombre: 'lo que escribio el operador' }
    act(() => {
      result.current.notifyChange()
      vi.advanceTimersByTime(1000)
    })
    const key = Object.keys(window.localStorage)[0]
    expect(JSON.parse(window.localStorage.getItem(key)!).data).toEqual({
      nombre: 'lo que escribio el operador',
    })
  })

  it('ignores the chrome of a floating layer this form never opened', () => {
    // El X que DialogContent dibuja FUERA del <form> anidado
    // (components/ui/dialog.tsx) y los botones de los alerts de useModal viven
    // adentro de un [role="dialog"] y no pertenecen a ningun <form>: la rama de
    // capas flotantes los contaba como una edicion de ESTE formulario porque
    // ignoraba `root`. Descartar un aviso de "no se pudo cargar el turno"
    // alcanzaba para dejar el gate de sucio encendido por el resto de la vida
    // de la pagina, sin que se tocara un solo campo del alta, asi que cualquier
    // default asincronico que resolviera despues se persistia como borrador de
    // valores intactos -- el aviso que entrena a la gente a ignorarlo.
    const ownForm = appendToBody(document.createElement('form'))
    const alertLayer = appendToBody(document.createElement('div'))
    alertLayer.setAttribute('role', 'dialog')
    const aceptar = alertLayer.appendChild(document.createElement('button'))

    let live = { recibidoPorId: '' }
    const { result } = renderHook(() =>
      useFormDraft({
        feature: 'orden-form',
        debounceMs: 1000,
        getValue: () => live,
        rootRef: { current: ownForm },
      })
    )

    act(() => {
      aceptar.dispatchEvent(new Event('click', { bubbles: true }))
    })
    live = { recibidoPorId: 'user-1' }
    act(() => {
      result.current.notifyChange()
      vi.advanceTimersByTime(2000)
    })
    expect(window.localStorage.length).toBe(0)
  })

  it('still counts a portalled select opened from the form', () => {
    // Radix saca selects y menus a un portal al final de <body>: el control que
    // el usuario abrio DESDE este formulario ya no esta adentro de el, y sigue
    // siendo una edicion. Lo que lo ata a este formulario es `aria-controls`:
    // el trigger (adentro del <form>) apunta al id del contenido que abrio.
    // Ese es el DOM real que renderiza Radix -- ver `contentId` en
    // @radix-ui/react-select y @radix-ui/react-popover.
    const ownForm = appendToBody(document.createElement('form'))
    const trigger = ownForm.appendChild(document.createElement('button'))
    trigger.setAttribute('role', 'combobox')
    trigger.setAttribute('aria-controls', 'radix-content-1')
    trigger.setAttribute('aria-expanded', 'true')
    const popper = appendToBody(document.createElement('div'))
    popper.setAttribute('data-radix-popper-content-wrapper', '')
    const content = popper.appendChild(document.createElement('div'))
    content.id = 'radix-content-1'
    content.setAttribute('role', 'listbox')
    const option = content.appendChild(document.createElement('div'))
    option.setAttribute('role', 'option')

    let live = { tecnicoId: '' }
    const { result } = renderHook(() =>
      useFormDraft({
        feature: 'orden-form',
        debounceMs: 1000,
        getValue: () => live,
        rootRef: { current: ownForm },
      })
    )

    act(() => {
      option.dispatchEvent(new Event('click', { bubbles: true }))
    })
    live = { tecnicoId: 'tec-1' }
    act(() => {
      result.current.notifyChange()
      vi.advanceTimersByTime(1000)
    })

    const key = Object.keys(window.localStorage)[0]
    expect(JSON.parse(window.localStorage.getItem(key)!).data).toEqual({ tecnicoId: 'tec-1' })
  })

  it('flushes a pending write when the page is hidden', () => {
    // El unico flush de salida era la limpieza de un efecto de React, que no
    // corre al cerrar la pestana ni cuando iOS suspende la PWA -- justo los
    // escenarios que el hook dice cubrir.
    const { rerender } = renderDraft({ nombre: '' })
    userInteracts()
    rerender({ value: { nombre: 'A medio escribir' } })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(window.localStorage.length).toBe(0)

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    const key = Object.keys(window.localStorage)[0]
    expect(key).toBeDefined()
    expect(JSON.parse(window.localStorage.getItem(key)!).data).toEqual({
      nombre: 'A medio escribir',
    })
  })

  it('does not read or write while disabled', () => {
    const key = 'draft:v2:cliente-form:org-1:user-1:new'
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, savedAt: Date.now(), data: { nombre: 'Ana' } })
    )

    const { result, rerender } = renderDraft({ nombre: '' }, { feature: 'cliente-form', enabled: false })
    userInteracts()
    rerender({ value: { nombre: 'x' } })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.ready).toBe(false)
    expect(result.current.draft).toBeNull()
    // Existing draft in storage is left untouched (not read, not deleted).
    expect(JSON.parse(window.localStorage.getItem(key)!).data).toEqual({ nombre: 'Ana' })
  })

  it('fails silently when localStorage.setItem throws (quota exceeded)', () => {
    const setItemSpy = vi
      .spyOn(window.localStorage.__proto__, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

    const { result, rerender } = renderDraft({ a: 1 })
    expect(result.current.ready).toBe(true)
    userInteracts()

    expect(() => {
      rerender({ value: { a: 2 } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
    }).not.toThrow()

    setItemSpy.mockRestore()
  })
})
