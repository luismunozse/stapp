/**
 * El modal se abre desde dos intenciones distintas: "contratar el plan" (donde
 * pago unico es el default a proposito, para no empujar una autorizacion
 * permanente sobre la tarjeta) y "activar el debito automatico" desde el plan
 * ya vigente, donde el taller YA eligio adherirse antes de abrirlo. El modal
 * queda montado entre aperturas, asi que ademas hay que probar que el modo no
 * se quede pegado de la vez anterior.
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

function radio(nombre: RegExp) {
  return screen.getByRole("radio", { name: nombre }) as HTMLInputElement
}

function fetchUrls() {
  return (global.fetch as any).mock.calls.map((call: any[]) => call[0])
}

describe("UpgradeModal — modo de cobro inicial", () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/subscriptions") {
        return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ initPoint: "https://mp.test/pago" }),
      })
    }) as any
  })

  it("abierto para adherirse, arranca en debito automatico", () => {
    render(<UpgradeModal open modoCobroInicial="automatico" onClose={vi.fn()} />)

    expect(radio(/débito automático/i).checked).toBe(true)
    expect(radio(/pago único/i).checked).toBe(false)
  })

  it("abierto para adherirse, el boton paga contra la ruta de adhesion sin tocar nada", async () => {
    render(<UpgradeModal open modoCobroInicial="automatico" onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: /continuar al pago/i }))

    await waitFor(() => {
      expect(fetchUrls()).toContain("/api/mercadopago/preapproval")
    })
    expect(fetchUrls()).not.toContain("/api/mercadopago/preference")
  })

  it("sin la prop sigue arrancando en pago unico", () => {
    render(<UpgradeModal open onClose={vi.fn()} />)

    expect(radio(/pago único/i).checked).toBe(true)
  })

  it("al reabrirse vuelve al modo inicial y no queda pegado el de la vez anterior", () => {
    const { rerender } = render(<UpgradeModal open onClose={vi.fn()} />)

    fireEvent.click(radio(/débito automático/i))
    expect(radio(/débito automático/i).checked).toBe(true)

    rerender(<UpgradeModal open={false} onClose={vi.fn()} />)
    rerender(<UpgradeModal open onClose={vi.fn()} />)

    expect(radio(/pago único/i).checked).toBe(true)
  })
})
