/**
 * Every "create order" CTA links to /ordenes?nueva=1, but OrdenesList only
 * honored fromTurno/clienteId, so the form never opened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { OrdenesList } from "@/components/ordenes/ordenes-list"
import { silenceSkeletonNoise } from "./silence-skeleton-noise"

const replace = vi.fn()
let search = ""

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/ordenes",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => d }),
}))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn(), showSuccess: vi.fn(), confirm: vi.fn() }),
}))

vi.mock("@/components/ordenes/orden-form", () => ({
  OrdenForm: () => <div data-testid="orden-form" />,
}))

function renderList() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdenesList />
    </SWRConfig>
  )
}

describe("OrdenesList — ?nueva=1", () => {
  beforeEach(() => {
    silenceSkeletonNoise()
    replace.mockClear()
    search = ""
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) })
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("opens the form and strips the param keeping the others", async () => {
    search = "nueva=1&estado=RECIBIDO"
    renderList()

    expect(await screen.findByTestId("orden-form")).toBeInTheDocument()
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/ordenes?estado=RECIBIDO"))
  })

  it("strips the param to the bare path when it is the only one", async () => {
    search = "nueva=1"
    renderList()

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/ordenes"))
  })

  it("does not open the form without the param", async () => {
    renderList()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByTestId("orden-form")).not.toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })
})
