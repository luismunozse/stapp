// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"

const showError = vi.fn(async () => {})
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ showError }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }))

import { NotaCreditoDialog } from "@/components/notas-credito/nota-credito-dialog"

const fila = (monto: number, anulada: boolean) => ({ id: `nc-${monto}`, numero: "NC-1", monto, anulada })

type Respuesta = { ok: boolean; body: unknown } | "red"

/** fetch: el GET de las NC de la orden devuelve `previas`; cada POST consume una respuesta. */
function stubFetch(previas: unknown[], posts: Respuesta[]) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init || init.method !== "POST") return { ok: true, status: 200, json: async () => previas }
    const r = posts.shift()
    if (!r || r === "red") throw new TypeError("Failed to fetch")
    return { ok: r.ok, status: r.ok ? 201 : 409, json: async () => r.body }
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

const renderDialog = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NotaCreditoDialog open onOpenChange={() => {}} ordenId="o-1" totalCobrado={1000} />
    </SWRConfig>
  )

const postBodies = (fn: ReturnType<typeof stubFetch>) =>
  fn.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))

describe("NotaCreditoDialog — tope y idempotencia", () => {
  beforeEach(() => vi.clearAllMocks())

  it("el máximo descuenta las NC previas no anuladas de la orden", async () => {
    stubFetch([fila(300, false), fila(200, true)], [])
    renderDialog()
    expect(await screen.findByText(/Máximo: \$700\.00/)).toBeInTheDocument()
  })

  it("no deja emitir por encima de lo disponible", async () => {
    const fn = stubFetch([fila(300, false)], [])
    renderDialog()
    await screen.findByText(/Máximo: \$700\.00/)

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "800" } })
    fireEvent.click(screen.getByRole("button", { name: /Emitir NC/ }))

    await waitFor(() => expect(showError).toHaveBeenCalled())
    expect(postBodies(fn)).toHaveLength(0)
  })

  it("un reintento tras un error de red manda la misma clave de idempotencia", async () => {
    const fn = stubFetch([], ["red", { ok: true, body: { id: "nc1", numero: "NC-1" } }])
    renderDialog()
    await screen.findByText(/Máximo: \$1000\.00/)

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "100" } })
    fireEvent.click(screen.getByRole("button", { name: /Emitir NC/ }))
    await waitFor(() => expect(showError).toHaveBeenCalledWith("Error de red"))
    fireEvent.click(screen.getByRole("button", { name: /Emitir NC/ }))
    await waitFor(() => expect(postBodies(fn)).toHaveLength(2))

    const [primero, segundo] = postBodies(fn)
    expect(primero.idempotencyKey).toEqual(expect.any(String))
    expect(primero.idempotencyKey.length).toBeGreaterThan(0)
    expect(segundo.idempotencyKey).toBe(primero.idempotencyKey)
    expect(primero.ordenId).toBe("o-1")
  })
})
