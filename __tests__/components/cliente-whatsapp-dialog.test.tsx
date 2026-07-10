// __tests__/components/cliente-whatsapp-dialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ClienteWhatsAppDialog } from "@/components/clientes/cliente-whatsapp-dialog"
import type { Cliente } from "@/types"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ pais: "AR", currency: "ARS" }),
}))

function makeCliente(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: "cliente-1",
    nombre: "Juan Perez",
    telefono: "1100000000",
    email: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function mockFetchImpl(deuda: { ok: boolean; body?: unknown; reject?: boolean }) {
  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/deuda-sucursal")) {
      if (deuda.reject) return Promise.reject(new Error("network error"))
      if (!deuda.ok) return Promise.resolve({ ok: false, json: async () => ({}) })
      return Promise.resolve({ ok: true, json: async () => deuda.body })
    }
    if (typeof url === "string" && url.includes("/api/notificaciones/config")) {
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }
    return Promise.resolve({ ok: false, json: async () => ({}) })
  })
}

describe("ClienteWhatsAppDialog — recordatorio de pago por deuda de sucursal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })

  it("muestra la plantilla 'Recordatorio de pago' cuando la deuda combinada es > 0", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchImpl({ ok: true, body: { deudaTotal: 8000, deudaFiado: 5000, deudaOrdenes: 3000 } }),
    )
    render(
      <ClienteWhatsAppDialog cliente={makeCliente()} organizationName="ACME" open onOpenChange={vi.fn()} />,
    )
    expect(await screen.findByRole("button", { name: /recordatorio de pago/i })).toBeInTheDocument()
  })

  it("NO muestra la plantilla cuando la deuda combinada es 0", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchImpl({ ok: true, body: { deudaTotal: 0, deudaFiado: 0, deudaOrdenes: 0 } }),
    )
    render(
      <ClienteWhatsAppDialog cliente={makeCliente()} organizationName="ACME" open onOpenChange={vi.fn()} />,
    )
    // Esperamos a que termine de cargar (una plantilla siempre disponible sin deuda)
    await screen.findByRole("button", { name: /bienvenida/i })
    expect(screen.queryByRole("button", { name: /recordatorio de pago/i })).not.toBeInTheDocument()
  })

  it("degrada sin romper el dialog cuando el fetch de deuda responde error", async () => {
    vi.stubGlobal("fetch", mockFetchImpl({ ok: false }))
    render(
      <ClienteWhatsAppDialog cliente={makeCliente()} organizationName="ACME" open onOpenChange={vi.fn()} />,
    )
    await screen.findByRole("button", { name: /bienvenida/i })
    expect(screen.queryByRole("button", { name: /recordatorio de pago/i })).not.toBeInTheDocument()
  })

  it("degrada sin romper el dialog cuando el fetch de deuda rechaza (error de red)", async () => {
    vi.stubGlobal("fetch", mockFetchImpl({ ok: true, reject: true }))
    render(
      <ClienteWhatsAppDialog cliente={makeCliente()} organizationName="ACME" open onOpenChange={vi.fn()} />,
    )
    await screen.findByRole("button", { name: /bienvenida/i })
    expect(screen.queryByRole("button", { name: /recordatorio de pago/i })).not.toBeInTheDocument()
  })
})
