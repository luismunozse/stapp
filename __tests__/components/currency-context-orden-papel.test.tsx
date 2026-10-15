/**
 * The root CurrencyProvider already reads /api/configuracion/operativa for every screen. It also
 * carries the organization's default paper size for the printed order, so the print buttons can
 * show it without a request of their own. A server without the setting (the column is added by a
 * migration applied by hand after the deploy) answers nothing for it: that reads A4.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CurrencyProvider, useCurrency } from "@/contexts/currency-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org-1" } } }),
}))

const answer = (body: Record<string, unknown>) => ({
  ok: true,
  headers: { get: () => "application/json" },
  json: async () => body,
})

function Probe() {
  const { ordenFormatoPapel } = useCurrency()
  return <span data-testid="papel">{ordenFormatoPapel}</span>
}

describe("CurrencyProvider: ordenFormatoPapel", () => {
  it("is the size the operativa answer carries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(answer({ moneda: "ARS", ordenFormatoPapel: "A6" })))
    render(
      <CurrencyProvider>
        <Probe />
      </CurrencyProvider>,
    )
    expect(await screen.findByText("A6")).toBeInTheDocument()
  })

  it("is A4 before the answer arrives", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
    render(
      <CurrencyProvider>
        <Probe />
      </CurrencyProvider>,
    )
    expect(screen.getByTestId("papel").textContent).toBe("A4")
  })

  it("stays A4 when the answer has no size, or one that is not valid", async () => {
    for (const body of [{ moneda: "ARS" }, { moneda: "ARS", ordenFormatoPapel: "A3" }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(answer(body)))
      const view = render(
        <CurrencyProvider>
          <Probe />
        </CurrencyProvider>,
      )
      // wait for the answer to be applied: the currency of the answer is read, then the size
      await new Promise((r) => setTimeout(r, 20))
      expect(screen.getByTestId("papel").textContent).toBe("A4")
      view.unmount()
    }
  })
})
