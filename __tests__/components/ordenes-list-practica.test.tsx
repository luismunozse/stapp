/**
 * The onboarding practice order shows up in the orders list with a badge and
 * its own "Borrar práctica" action. It is never selectable for bulk state
 * changes or cobros, and the generic trash button is not offered for it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { OrdenesList } from "@/components/ordenes/ordenes-list"

const push = vi.fn()
const confirm = vi.fn()
const showError = vi.fn()
let role = "ADMIN"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/ordenes",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role } } }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => d }),
}))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError, showSuccess: vi.fn(), confirm }),
}))

vi.mock("@/components/ordenes/orden-form", () => ({
  OrdenForm: () => null,
}))

const PRACTICA = {
  id: "prac-1",
  numeroOrden: 0,
  codigoOrden: "PRACTICA",
  estado: "RECIBIDO",
  dispositivo: "Gafa HGF-357",
  tipoDispositivo: "HELADERA",
  fechaIngreso: "2026-10-11",
  esPractica: true,
  cliente: { id: "cli-prac", nombre: "Ana Pérez", telefono: "" },
}
const REAL = { ...PRACTICA, id: "real-1", numeroOrden: 1, codigoOrden: "HEL0001", esPractica: false }

function stubFetch(ordenes: unknown[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/onboarding/practica" && init?.method === "DELETE") {
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    if (url.startsWith("/api/ordenes?")) {
      return { ok: true, status: 200, json: async () => ({ data: ordenes, total: ordenes.length }) }
    }
    return { ok: true, status: 200, json: async () => [] }
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function listCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/ordenes?")).length
}

function renderList() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdenesList />
    </SWRConfig>
  )
}

// DataTable's loading skeleton nests <tr> rows inside a <td> (a pre-existing
// quirk that React reports as two console.error calls). Drop exactly those two
// messages; anything else still reaches the real console.
function esRuidoDelSkeleton([formato, ...resto]: unknown[]) {
  if (typeof formato !== "string") return false
  const [a, b] = resto
  return (
    (formato.startsWith("In HTML, %s cannot be a child of <%s>.") && a === "<tr>" && b === "td") ||
    (formato.startsWith("<%s> cannot contain a nested %s.") && a === "td" && b === "<tr>")
  )
}

// jsdom ignores the `hidden sm:block` / `sm:hidden` classes, so the desktop
// table and the mobile cards both render: every practice control shows twice.
describe("OrdenesList — practice order", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const consoleError = console.error
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      if (!esRuidoDelSkeleton(args)) consoleError(...args)
    })
    role = "ADMIN"
    confirm.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows the practice badge with the deletion notice", async () => {
    stubFetch([PRACTICA])
    renderList()

    expect(await screen.findAllByText("Práctica")).toHaveLength(2)
    expect(screen.getAllByText(/se borra cuando cargues tu primera orden real/)).toHaveLength(2)
  })

  it("does not badge a real order", async () => {
    stubFetch([REAL])
    renderList()

    await screen.findAllByText("HEL0001")
    expect(screen.queryByText("Práctica")).not.toBeInTheDocument()
  })

  it("Borrar práctica deletes through the practice endpoint without opening the order", async () => {
    const fetchMock = stubFetch([PRACTICA])
    renderList()
    const [boton] = await screen.findAllByRole("button", { name: /Borrar práctica/i })
    const antes = listCalls(fetchMock)

    fireEvent.click(boton)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/onboarding/practica", { method: "DELETE" })
    )
    expect(push).not.toHaveBeenCalled()
    await waitFor(() => expect(listCalls(fetchMock)).toBeGreaterThan(antes))
  })

  it("does nothing when the confirmation is cancelled", async () => {
    confirm.mockResolvedValue(false)
    const fetchMock = stubFetch([PRACTICA])
    renderList()
    const [boton] = await screen.findAllByRole("button", { name: /Borrar práctica/i })

    fireEvent.click(boton)

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false)
  })

  it("offers no bulk checkbox and no generic delete for the practice order", async () => {
    stubFetch([PRACTICA, REAL])
    renderList()
    await screen.findAllByText("HEL0001")

    // Only the real order keeps its row checkbox (desktop table).
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    // The desktop trash button is labelled "Eliminar"; only the real order has it.
    expect(screen.getAllByRole("button", { name: "Eliminar" })).toHaveLength(1)
  })

  it("hides the bulk-select toggle when only the practice order is listed", async () => {
    stubFetch([PRACTICA])
    renderList()
    await screen.findAllByText("Práctica")

    expect(screen.queryByRole("button", { name: /Seleccionar/ })).not.toBeInTheDocument()
  })

  it("keeps the bulk-select toggle when a real order is listed", async () => {
    stubFetch([PRACTICA, REAL])
    renderList()
    await screen.findAllByText("HEL0001")

    expect(screen.getByRole("button", { name: /Seleccionar/ })).toBeInTheDocument()
  })

  it("hides Borrar práctica from non-admin roles", async () => {
    role = "VENDEDOR"
    stubFetch([PRACTICA])
    renderList()
    await screen.findAllByText("Práctica")

    expect(screen.queryByRole("button", { name: /Borrar práctica/i })).not.toBeInTheDocument()
  })
})
