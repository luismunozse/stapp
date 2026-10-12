import { describe, it, expect } from "vitest"
import { construirMensajePedidoWhatsApp, NOTAS_PEDIDO_MAX } from "@/lib/catalogo/pedido-whatsapp"

const fmt = (n: number) => `$${n.toLocaleString("es-AR")}`

describe("construirMensajePedidoWhatsApp", () => {
  it("lista cada item con cantidad, precio unitario y subtotal, más el total", () => {
    const msg = construirMensajePedidoWhatsApp({
      taller: "Taller Sur",
      items: [
        { nombre: "Funda", cantidad: 2, precio: 1500 },
        { nombre: "Celular", varianteEtiqueta: "256GB", cantidad: 1, precio: 90000 },
      ],
      total: 93000,
      formatPrecio: fmt,
    })
    expect(msg).toContain("Taller Sur")
    expect(msg).toContain("• 2× Funda — $1.500 c/u = $3.000")
    expect(msg).toContain("• 1× Celular (256GB) — $90.000 c/u = $90.000")
    expect(msg).toContain("Total: $93.000")
  })

  it("no menciona variante cuando el item no la tiene", () => {
    const msg = construirMensajePedidoWhatsApp({
      taller: "T",
      items: [{ nombre: "Funda", varianteEtiqueta: null, cantidad: 1, precio: 10 }],
      total: 10,
      formatPrecio: fmt,
    })
    expect(msg).not.toContain("(")
  })

  it("incluye nombre y notas solo si vienen", () => {
    const base = { taller: "T", items: [{ nombre: "A", cantidad: 1, precio: 1 }], total: 1, formatPrecio: fmt }
    const sin = construirMensajePedidoWhatsApp(base)
    expect(sin).not.toContain("Nombre:")
    expect(sin).not.toContain("Notas:")
    const con = construirMensajePedidoWhatsApp({ ...base, cliente: "Ana", notas: "Retiro el sábado" })
    expect(con).toContain("Nombre: Ana")
    expect(con).toContain("Notas: Retiro el sábado")
  })

  it("recorta las notas largas para que el link de wa.me no explote", () => {
    const msg = construirMensajePedidoWhatsApp({
      taller: "T", items: [{ nombre: "A", cantidad: 1, precio: 1 }], total: 1, formatPrecio: fmt,
      notas: "x".repeat(NOTAS_PEDIDO_MAX + 300),
    })
    expect(msg.length).toBeLessThan(NOTAS_PEDIDO_MAX + 200)
    expect(msg).not.toContain("x".repeat(NOTAS_PEDIDO_MAX + 1))
  })

  it("usa el formateador de moneda recibido", () => {
    const msg = construirMensajePedidoWhatsApp({
      taller: "T",
      items: [{ nombre: "A", cantidad: 1, precio: 5 }],
      total: 5,
      formatPrecio: (n) => `USD ${n}`,
    })
    expect(msg).toContain("Total: USD 5")
  })
})
