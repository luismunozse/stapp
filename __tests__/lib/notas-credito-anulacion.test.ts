// @vitest-environment node
import { describe, it, expect } from "vitest"
import { bloqueoAnulacionNC, reversaDeNotaCredito, ultimaActiva } from "@/lib/notas-credito/anulacion"

const nc = (id: string, numero: string, createdAt: string, anulada = false) => ({
  id, numeroDevolucion: numero, createdAt, anulada,
})
const formatPrice = (n: number) => `$${n.toFixed(2)}`
const ULTIMA = "La nota de crédito queda anulada: se sigue viendo con su número y el PDF sale con el sello ANULADA."

describe("ultimaActiva — la única que se puede anular", () => {
  it("la más reciente de las activas, sin mirar las anuladas", () => {
    const todas = [
      nc("a", "NC-000010", "2026-10-01T10:00:00+00:00"),
      nc("b", "NC-000011", "2026-10-02T10:00:00+00:00"),
      nc("c", "NC-000012", "2026-10-03T10:00:00+00:00", true),
    ]
    expect(ultimaActiva(todas)?.id).toBe("b")
  })

  it("con la misma fecha desempata el número, como la base", () => {
    const t = "2026-10-01T10:00:00+00:00"
    expect(ultimaActiva([nc("a", "NC-000010", t), nc("b", "NC-000011", t)])?.id).toBe("b")
  })

  it("sin activas, ninguna", () => {
    expect(ultimaActiva([nc("a", "NC-000010", "2026-10-01T10:00:00+00:00", true)])).toBeNull()
  })
})

describe("bloqueoAnulacionNC — los mismos motivos y el mismo orden que la base (369)", () => {
  const vieja = nc("a", "NC-000010", "2026-10-01T10:00:00+00:00")
  const nueva = nc("b", "NC-000011", "2026-10-02T10:00:00+00:00")

  it("la más reciente de una venta vigente se puede anular", () => {
    expect(bloqueoAnulacionNC(nueva, [vieja, nueva], "COMPLETADA")).toBeNull()
  })

  it("una anterior espera a la más reciente", () => {
    expect(bloqueoAnulacionNC(vieja, [vieja, nueva], "COMPLETADA")).toBe(
      "Se anulan de la más reciente a la primera: primero anulá la NC-000011."
    )
  })

  it("la venta anulada", () => {
    expect(bloqueoAnulacionNC(nueva, [vieja, nueva], "ANULADA")).toBe(
      "La venta está anulada: sus notas de crédito ya no se pueden anular."
    )
  })

  it("el historial DEV-", () => {
    const dev = nc("d", "DEV-0007", "2026-10-03T10:00:00+00:00")
    expect(bloqueoAnulacionNC(dev, [vieja, dev], "COMPLETADA")).toBe(
      "Las devoluciones anteriores a las notas de crédito (DEV-) no se pueden anular."
    )
  })

  it("una ya anulada", () => {
    expect(bloqueoAnulacionNC(nc("c", "NC-000012", "2026-10-03T10:00:00+00:00", true), [vieja], "COMPLETADA")).toBe(
      "Ya está anulada."
    )
  })
})

describe("reversaDeNotaCredito — qué deshace la anulación, en palabras del taller", () => {
  it("productos que volvieron al stock, devueltos en efectivo", () => {
    expect(
      reversaDeNotaCredito(
        {
          montoAplicadoDeuda: 0, montoReembolso: 200, metodoReembolso: "EFECTIVO",
          items: [{ descripcion: "Celular", cantidad: 2, restaurarStock: true }],
        },
        { formatPrice, tieneCliente: true, saldoCliente: 0 }
      )
    ).toEqual([
      "Vuelven a salir del stock: 2 × Celular.",
      "Los productos devueltos vuelven a quedar vendidos al cliente, con su número de serie y su garantía si tenían.",
      "Vuelven a entrar a la caja $200.00 en efectivo: el cliente devuelve lo que se le dio.",
      ULTIMA,
    ])
  })

  it("por monto, con deuda y un saldo a favor que el cliente ya usó: queda debiendo", () => {
    expect(
      reversaDeNotaCredito(
        { montoAplicadoDeuda: 40, montoReembolso: 10, metodoReembolso: "CUENTA_CORRIENTE", items: [] },
        { formatPrice, tieneCliente: true, saldoCliente: 5 }
      )
    ).toEqual([
      "La deuda de la venta vuelve a subir $40.00.",
      "Se le cargan $50.00 en la cuenta corriente: el saldo pasa de $5.00 a $-45.00 (queda debiendo).",
      ULTIMA,
    ])
  })

  it("transferencia: el sistema no mueve esa plata", () => {
    const lineas = reversaDeNotaCredito(
      { montoAplicadoDeuda: 0, montoReembolso: 30, metodoReembolso: "TRANSFERENCIA", items: [] },
      { formatPrice, tieneCliente: false, saldoCliente: null }
    )
    expect(lineas).toContain(
      "Se le devolvieron $30.00 por transferencia: el sistema no mueve esa plata; si corresponde, recuperala por fuera."
    )
    expect(lineas.some((l) => l.includes("cuenta corriente"))).toBe(false)
  })

  it("venta de mostrador fiada (sin cliente): vuelve la deuda, sin cuenta corriente", () => {
    expect(
      reversaDeNotaCredito(
        { montoAplicadoDeuda: 25, montoReembolso: 0, metodoReembolso: null, items: [] },
        { formatPrice, tieneCliente: false, saldoCliente: null }
      )
    ).toEqual(["La deuda de la venta vuelve a subir $25.00.", ULTIMA])
  })

  it("sin el saldo del cliente, solo dice cuánto se carga", () => {
    expect(
      reversaDeNotaCredito(
        { montoAplicadoDeuda: 0, montoReembolso: 20, metodoReembolso: "CUENTA_CORRIENTE", items: [] },
        { formatPrice, tieneCliente: true, saldoCliente: null }
      )
    ).toContain("Se le cargan $20.00 en la cuenta corriente.")
  })
})
