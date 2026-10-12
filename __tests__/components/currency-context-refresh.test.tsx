/**
 * The root CurrencyProvider fetched the org config once per organizationId.
 * After a rubro change in the onboarding wizard, the next screen kept the old
 * vocabulary until a full reload. refreshConfig() re-reads it.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CurrencyProvider, useCurrency, useTerminologia } from "@/contexts/currency-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org-1" } } }),
}))

function config(terminologia: Record<string, string>) {
  return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ terminologia }) }
}

function Consumidor() {
  const { refreshConfig } = useCurrency()
  const term = useTerminologia()
  return (
    <>
      <span>{term("equipo")}</span>
      <button onClick={refreshConfig}>recargar</button>
    </>
  )
}

describe("CurrencyProvider.refreshConfig", () => {
  it("re-reads the org config on demand", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(config({ equipo: "Artefacto" }))
      .mockResolvedValueOnce(config({ equipo: "Vehículo" }))
    vi.stubGlobal("fetch", fetchMock)

    render(
      <CurrencyProvider>
        <Consumidor />
      </CurrencyProvider>
    )
    expect(await screen.findByText("Artefacto")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "recargar" }))

    expect(await screen.findByText("Vehículo")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith("/api/configuracion/operativa", expect.anything())
  })
})
