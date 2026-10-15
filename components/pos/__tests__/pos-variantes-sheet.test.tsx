// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { PosVariantesSheet } from "@/components/pos/pos-variantes-sheet"

// The Radix sheet unmounts its content at once in jsdom, so the slide-out frames cannot be seen.
// A passthrough that keeps rendering its children lets these tests look at what a closing sheet
// would draw during the animation.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: any) => <div>{children}</div>,
  SheetContent: ({ children }: any) => <div role="dialog">{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
  SheetDescription: ({ children }: any) => <p>{children}</p>,
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

const ROJO = { id: "rojo", codigo: "R", nombre: "Funda X - Rojo", etiqueta: "Rojo", stock: 5, precioVenta: 10000, grupoId: "g-1" }
const GRUPO = { grupoId: "g-1", nombre: "Funda X" }

interface Pendiente {
  signal: AbortSignal | undefined
  resolver: (filas: unknown[]) => void
}

function stubFetchPendiente() {
  const pendientes: Pendiente[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((resolve) => {
        // Like a server that answers anyway: it ignores the abort, so only the guard stops it.
        pendientes.push({
          signal: init?.signal ?? undefined,
          resolver: (filas) => resolve({ ok: true, status: 200, json: async () => filas }),
        })
      })
    })
  )
  return pendientes
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe("PosVariantesSheet: closing", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("keeps the group title and rows while it closes instead of flashing the loading state", async () => {
    const pendientes = stubFetchPendiente()
    const props = { onClose: vi.fn(), onAdd: vi.fn() }
    const { rerender } = render(<PosVariantesSheet grupo={GRUPO} {...props} />)
    await act(async () => pendientes[0].resolver([ROJO]))
    await flush()
    expect(screen.getByText("Rojo")).toBeTruthy()

    rerender(<PosVariantesSheet grupo={null} {...props} />)

    expect(screen.getByRole("heading").textContent).toBe("Funda X")
    expect(screen.getByText("Rojo")).toBeTruthy()
    expect(screen.queryByText("Cargando variantes...")).toBeNull()
  })

  it("aborts the request on close and ignores an answer that arrives after it", async () => {
    const pendientes = stubFetchPendiente()
    const props = { onClose: vi.fn(), onAdd: vi.fn() }
    const { rerender } = render(<PosVariantesSheet grupo={GRUPO} {...props} />)
    expect(pendientes).toHaveLength(1)
    expect(pendientes[0].signal?.aborted).toBe(false)

    rerender(<PosVariantesSheet grupo={null} {...props} />)
    expect(pendientes[0].signal?.aborted).toBe(true)

    // Reopen the same group: a second request is in flight. The stale answer of the first must not
    // fill the sheet.
    rerender(<PosVariantesSheet grupo={GRUPO} {...props} />)
    expect(pendientes).toHaveLength(2)
    await act(async () => pendientes[0].resolver([ROJO]))
    await flush()

    expect(screen.getByText("Cargando variantes...")).toBeTruthy()
    expect(screen.queryByText("Rojo")).toBeNull()

    await act(async () => pendientes[1].resolver([ROJO]))
    await flush()
    expect(screen.getByText("Rojo")).toBeTruthy()
  })

  it("aborts the request when the sheet unmounts", () => {
    const pendientes = stubFetchPendiente()
    const { unmount } = render(<PosVariantesSheet grupo={GRUPO} onClose={vi.fn()} onAdd={vi.fn()} />)
    unmount()
    expect(pendientes[0].signal?.aborted).toBe(true)
  })
})
