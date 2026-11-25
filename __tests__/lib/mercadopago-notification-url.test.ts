import { describe, it, expect, vi, afterEach } from "vitest"
import { getMercadoPagoNotificationUrl } from "@/lib/mercadopago"

/**
 * NEXTAUTH_URL en producción es https://www.stapp.com.ar y www responde 308.
 * MercadoPago no sigue redirecciones: si el notification_url apunta a www, el
 * aviso del pago se pierde y hay que conciliar a mano.
 */
describe("getMercadoPagoNotificationUrl", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("en producción usa el dominio raíz, no el www de NEXTAUTH_URL", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXTAUTH_URL", "https://www.stapp.com.ar")
    vi.stubEnv("MERCADOPAGO_WEBHOOK_URL", "")
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "")
    expect(getMercadoPagoNotificationUrl()).toBe("https://stapp.com.ar/api/mercadopago/webhook")
  })

  it("le saca el www y la barra final al dominio raíz configurado", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MERCADOPAGO_WEBHOOK_URL", "")
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "https://www.stapp.com.ar/")
    expect(getMercadoPagoNotificationUrl()).toBe("https://stapp.com.ar/api/mercadopago/webhook")
  })

  it("MERCADOPAGO_WEBHOOK_URL tiene prioridad", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MERCADOPAGO_WEBHOOK_URL", "https://pagos.example.com/api/mercadopago/webhook")
    expect(getMercadoPagoNotificationUrl()).toBe("https://pagos.example.com/api/mercadopago/webhook")
  })

  it("en desarrollo usa NEXTAUTH_URL (túneles tipo ngrok)", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MERCADOPAGO_WEBHOOK_URL", "")
    vi.stubEnv("NEXTAUTH_URL", "https://abc.ngrok.io/")
    expect(getMercadoPagoNotificationUrl()).toBe("https://abc.ngrok.io/api/mercadopago/webhook")
  })
})
