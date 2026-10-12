// __tests__/components/upgrade-modal-modo-cobro.test.tsx
/**
 * El selector "modo de cobro" del UpgradeModal decide si el taller firma una
 * autorizacion permanente sobre su medio de pago (debito automatico via
 * MercadoPago preapproval) o hace un pago unico (preference). Pago unico es
 * el default a proposito -- ver comentario en upgrade-modal.tsx -- por eso
 * este test fija con un fetch mock a que ruta pega cada modo, para que una
 * inversion accidental de la condicion no pase desapercibida.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { UpgradeModal } from "@/components/billing/upgrade-modal"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
  },
}))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn() }),
}))

function fetchUrls() {
  return (global.fetch as any).mock.calls.map((call: any[]) => call[0])
}

describe("UpgradeModal — selector de modo de cobro (MercadoPago)", () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/subscriptions") {
        return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ initPoint: "https://mp.test/pago" }) })
    }) as any
  })

  it("por defecto (pago unico), el boton de pago pega a /api/mercadopago/preference", async () => {
    render(<UpgradeModal open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: /continuar al pago/i }))

    await waitFor(() => {
      expect(fetchUrls()).toContain("/api/mercadopago/preference")
    })
    expect(fetchUrls()).not.toContain("/api/mercadopago/preapproval")
  })

  it("al elegir debito automatico, el boton de pago pega a /api/mercadopago/preapproval", async () => {
    render(<UpgradeModal open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole("radio", { name: /débito automático/i }))
    fireEvent.click(screen.getByRole("button", { name: /continuar al pago/i }))

    await waitFor(() => {
      expect(fetchUrls()).toContain("/api/mercadopago/preapproval")
    })
    expect(fetchUrls()).not.toContain("/api/mercadopago/preference")
  })
})
