import { describe, it, expect } from "vitest"
import { estadoDesdeGrupo, type VariantesState } from "@/lib/variantes-filas"
import { aplicar, leida, reductor } from "../helpers/variantes-filas"

// "convertirPrecios": the group's currency changed and "Convertir" was chosen.
const porMil = (monto: number) => monto / 1000

function estado(): VariantesState {
  const base = estadoDesdeGrupo(
    {
      grupo: { id: "g1", nombre: "Funda", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul", "Verde", "Negro"] }] },
      variantes: [
        leida("r1", [{ opcion: "Color", valor: "Rojo" }], { precioVenta: 6000, precioCompra: 3000 }),
        leida("a1", [{ opcion: "Color", valor: "Azul" }], { precioVenta: 8000, precioCompra: 4000 }),
        leida("v1", [{ opcion: "Color", valor: "Verde" }], { precioVenta: 9000, precioCompra: 5000 }),
        leida("n1", [{ opcion: "Color", valor: "Negro" }], { precioVenta: 7000, precioCompra: 2000 }),
      ],
      archivadas: [],
    },
    { costoCargado: true, semilla: "s", precioBase: 5000, costoBase: 2000 }
  )
  // Hand-made row kinds: one marked to archive, one restored untouched, one restored with typed values.
  const { a1, v1, n1 } = base.filas
  const restauradaSinTocar = { ...v1, restaurada: true, precioTocado: false }
  delete restauradaSinTocar.precioCompra
  return {
    ...base,
    filas: {
      ...base.filas,
      a1: { ...a1, archivar: true },
      v1: restauradaSinTocar,
      n1: { ...n1, restaurada: true, precioTocado: true },
    },
  }
}

describe("convertirPrecios", () => {
  const convertido = aplicar(reductor(), estado(), { tipo: "convertirPrecios", convertir: porMil })

  it("convierte el precio y el costo base y los de una fila activa", () => {
    expect(convertido.precioBase).toBe(5)
    expect(convertido.costoBase).toBe(2)
    expect(convertido.filas.r1.precioVenta).toBe(6)
    expect(convertido.filas.r1.precioCompra).toBe(3)
  })

  it("no toca una fila a archivar", () => {
    expect(convertido.filas.a1.precioVenta).toBe(8000)
    expect(convertido.filas.a1.precioCompra).toBe(4000)
  })

  it("una fila restaurada sin tocar se deja como está (el cliente no vio su precio)", () => {
    expect(convertido.filas.v1.precioVenta).toBe(9000)
    expect(convertido.filas.v1).not.toHaveProperty("precioCompra")
  })

  it("una fila restaurada con precio y costo tipeados los convierte", () => {
    expect(convertido.filas.n1.precioVenta).toBe(7)
    expect(convertido.filas.n1.precioCompra).toBe(2)
  })

  it("no cambia si una fila sigue al precio base", () => {
    for (const id of ["r1", "a1", "v1", "n1"]) expect(convertido.filas[id].precioTocado).toBe(estado().filas[id].precioTocado)
  })
})
