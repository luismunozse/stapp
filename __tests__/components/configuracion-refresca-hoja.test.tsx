/**
 * An admin saves A6 in Configuracion and then opens an order without a full reload (SPA navigation):
 * the print selector must show A6 as "la del taller", not the A4 the provider read earlier.
 *
 * Real CurrencyProvider + real ConfiguracionForm + the hook the print buttons use, with a fake server
 * that remembers what was saved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { CurrencyProvider } from "@/contexts/currency-context"
import { ConfiguracionForm } from "@/components/configuracion/configuracion-form"
import { useOrdenPapel } from "@/components/ordenes/orden-papel-select"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org-1" } } }),
}))

let saved = "A4"
const json = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => body })

function config() {
  return {
    logoUrl: null, nombreEmpresa: "Taller Test", telefono: "", direccion: "", ciudad: "", provincia: "",
    codigoPostal: "", pais: "AR", moneda: "ARS", zonaHoraria: "America/Argentina/Buenos_Aires",
    ivaPorcentaje: 0, cotizacionValidezDias: 30, cotizacionTerminos: "", recepcionTerminos: "",
    comprobanteTerminos: "", garantiaDiasDefault: 30, politicaAbandonoDiasDefault: 60,
    anticipoPorcentajeDefault: 50, ivaRegimen: "EXENTO", ivaTasa: 21, redondeoEfectivo: 0,
    ordenFormatoPapel: saved,
  }
}

function Impresion() {
  const p = useOrdenPapel()
  return (
    <div>
      <span data-testid="papel">{p.papel}</span>
      <span data-testid="url">{p.pdfUrl("ord-1")}</span>
    </div>
  )
}

beforeEach(() => {
  saved = "A4"
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/configuracion/operativa")) return json({ moneda: "ARS", ordenFormatoPapel: saved })
      if (url === "/api/configuracion" && init?.method === "PUT") {
        saved = JSON.parse(String(init.body)).ordenFormatoPapel
        return json(config())
      }
      if (url === "/api/configuracion") return json(config())
      return json([])
    }),
  )
})

describe("saving the paper size in Configuracion", () => {
  it("makes the print selector show the new default without a reload", async () => {
    render(
      <ModalProvider>
        <CurrencyProvider>
          <ConfiguracionForm initialTab="comprobantes" />
          <Impresion />
        </CurrencyProvider>
      </ModalProvider>,
    )

    const select = (await screen.findByLabelText(/Tamaño de hoja para las órdenes/i)) as HTMLSelectElement
    expect(screen.getByTestId("papel").textContent).toBe("A4")

    fireEvent.change(select, { target: { value: "A6" } })
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))

    await waitFor(() => expect(screen.getByTestId("papel").textContent).toBe("A6"))
    // and the print goes out on what the selector shows
    expect(screen.getByTestId("url").textContent).toBe("/api/ordenes/ord-1/pdf?papel=A6")
  })
})
