import { describe, it, expect } from "vitest"
import { buildItemDescription, buildItemTitle } from "@/lib/catalogo/item-meta"

const base = {
  nombre: "BATERIA - BN5D - NOTE 11, NOTE 11S, POCO M4 PRO",
  orgName: "Celulares 30 de Agosto",
  moneda: "ARS" as const,
}

describe("buildItemDescription", () => {
  it("no deja que una descripcion de una palabra sea toda la meta description", () => {
    // El caso real que Search Console reportaba como "Descubierta, actualmente
    // sin indexar": el taller cargo "XIAOMI" y eso era la description entera.
    const desc = buildItemDescription({ ...base, descripcion: "XIAOMI", precio: 12500 })

    expect(desc).not.toBe("XIAOMI")
    expect(desc).toContain("BATERIA")
    expect(desc).toContain("XIAOMI")
    expect(desc).toContain("Celulares 30 de Agosto")
    expect(desc.length).toBeGreaterThan(60)
  })

  it("respeta la descripcion del taller cuando realmente describe el producto", () => {
    const propia =
      "Bateria original Xiaomi BN5D de 5000mAh con garantia de 6 meses, compatible con Redmi Note 11 y Poco M4 Pro"
    const desc = buildItemDescription({ ...base, descripcion: propia, precio: 12500 })

    expect(desc.startsWith("Bateria original Xiaomi")).toBe(true)
  })

  it("funciona sin descripcion ninguna", () => {
    const desc = buildItemDescription({ ...base, descripcion: null, precio: 12500 })

    expect(desc).toContain("BATERIA")
    expect(desc).toContain("Celulares 30 de Agosto")
    expect(desc.length).toBeGreaterThan(40)
  })

  it("suma las etiquetas cuando la descripcion es pobre", () => {
    const desc = buildItemDescription({
      ...base,
      nombre: "Modulo de pantalla",
      descripcion: "",
      etiquetas: ["Samsung", "Original", "Con marco"],
      precio: 45000,
    })

    expect(desc).toContain("Samsung")
    expect(desc).toContain("Original")
  })

  it("no repite una etiqueta que ya esta en el nombre", () => {
    const desc = buildItemDescription({
      ...base,
      nombre: "Modulo Samsung A54",
      descripcion: "",
      etiquetas: ["Samsung"],
      precio: 45000,
    })

    expect(desc.match(/Samsung/g)).toHaveLength(1)
  })

  it("muestra el rango cuando el item tiene precio hasta", () => {
    const desc = buildItemDescription({
      ...base,
      descripcion: "",
      precio: 12500,
      precioHasta: 18000,
    })

    expect(desc).toMatch(/a\s/)
    expect(desc).toContain("18")
  })

  it("no inventa un rango cuando ambos precios son iguales", () => {
    const desc = buildItemDescription({
      ...base,
      descripcion: "",
      precio: 12500,
      precioHasta: 12500,
    })

    expect(desc).not.toMatch(/12\.500 a 12\.500/)
  })

  it("avisa cuando no hay stock, y no afirma nada cuando si hay", () => {
    const sin = buildItemDescription({ ...base, descripcion: "", precio: 1, stockDisponible: 0 })
    const con = buildItemDescription({ ...base, descripcion: "", precio: 1, stockDisponible: 7 })

    expect(sin).toContain("Sin stock")
    expect(con).not.toContain("Sin stock")
    // El numero de stock cambia todo el tiempo; no se declara en la meta.
    expect(con).not.toContain("7")
  })

  it("no pasa el largo que el buscador muestra, y no corta a mitad de palabra", () => {
    const desc = buildItemDescription({
      ...base,
      nombre: "Modulo de pantalla OLED con marco premium para Samsung Galaxy S23 Ultra 5G edicion especial",
      descripcion: "Repuesto premium importado con garantia extendida de doce meses y colocacion incluida en el dia",
      precio: 450000,
    })

    expect(desc.length).toBeLessThanOrEqual(160)
    expect(desc).not.toMatch(/\s\S+…$/)
  })

  it("tolera precio nulo sin dejar puntuacion colgada", () => {
    const desc = buildItemDescription({ ...base, descripcion: "", precio: null })

    expect(desc).not.toMatch(/\.\s*\./)
    expect(desc.endsWith(".")).toBe(true)
  })

  it("normaliza los espacios que vienen del campo del taller", () => {
    const desc = buildItemDescription({ ...base, descripcion: "  XIAOMI\n\n  ", precio: 1 })

    expect(desc).not.toMatch(/\s{2}/)
    expect(desc).not.toContain("\n")
  })
})

describe("buildItemTitle", () => {
  it("mantiene el formato producto — taller", () => {
    expect(buildItemTitle("Bateria BN5D", "Celulares 30 de Agosto")).toBe(
      "Bateria BN5D — Celulares 30 de Agosto"
    )
  })

  it("recorta el producto, no el taller, cuando el nombre es largo", () => {
    const titulo = buildItemTitle(
      "Modulo de pantalla OLED con marco premium para Samsung Galaxy S23 Ultra 5G",
      "Celulares 30 de Agosto"
    )

    expect(titulo.endsWith("— Celulares 30 de Agosto")).toBe(true)
    expect(titulo).toContain("Modulo de pantalla")
  })
})
