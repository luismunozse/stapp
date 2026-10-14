// @vitest-environment node
import { describe, it, expect } from "vitest"
import { crearReductor, estadoInicial, filasEnOrden, type VariantesAccion, type VariantesState } from "@/lib/variantes-filas"
import { aplicar, etiquetas, grupoColorTalle, hidratar, opcionId, reductor } from "../../__tests__/helpers/variantes-filas"

const base = (): VariantesState =>
  aplicar(
    reductor(),
    estadoInicial({ grupoId: "g-nuevo", semilla: "valores-de-prueba", codigoBase: "FX", precioBase: 1000 }),
    { tipo: "activar" },
    { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] }
  )

const agregarValores = (estado: VariantesState, textos: string[]): VariantesAccion => ({ tipo: "agregarValores", opcionId: opcionId(estado, "Color"), textos })
const textos = (e: VariantesState) => e.opciones.find((o) => o.nombre === "Color")!.valores.map((v) => v.texto)

describe("agregarValores: a list of values in one action", () => {
  it("all accepted: the same state as adding them one by one, ids and counter included, and no message", () => {
    const estado = base()
    const junto = aplicar(reductor(), estado, agregarValores(estado, ["Verde", "Negro"]))
    const uno_a_uno = aplicar(
      reductor(),
      estado,
      { tipo: "agregarValor", opcionId: opcionId(estado, "Color"), texto: "Verde" },
      { tipo: "agregarValor", opcionId: opcionId(estado, "Color"), texto: "Negro" }
    )
    expect(textos(junto)).toEqual(["Rojo", "Azul", "Verde", "Negro"])
    expect(junto).toEqual(uno_a_uno)
    expect(junto.aviso).toBeNull()
    expect(etiquetas(junto)).toEqual(["Rojo", "Azul", "Verde", "Negro"])
  })

  it("mixed: keeps every accepted value and lists the refusals in one message", () => {
    const estado = base()
    const junto = aplicar(reductor(), estado, agregarValores(estado, ["rojo", "Verde", "azul"]))
    expect(textos(junto)).toEqual(["Rojo", "Azul", "Verde"])
    // The reason already names the value, so it is not repeated.
    expect(junto.aviso).toBe('El valor "rojo" está repetido en Color; El valor "azul" está repetido en Color')
    expect(etiquetas(junto)).toEqual(["Rojo", "Azul", "Verde"])
  })

  it("a reason that does not name the value gets the value in front of it", () => {
    const cien = aplicar(
      reductor(),
      estadoInicial({ grupoId: "g", semilla: "cien" }),
      { tipo: "activar" },
      { tipo: "agregarOpcion", nombre: "Color", valores: Array.from({ length: 100 }, (_, i) => `V${i + 1}`) }
    )
    const junto = aplicar(reductor(), cien, agregarValores(cien, ["X", "Y"]))
    expect(textos(junto)).toHaveLength(100)
    expect(junto.aviso).toBe(
      'No se agregó "X": Una opción puede tener hasta 100 valores; No se agregó "Y": Una opción puede tener hasta 100 valores'
    )
  })

  it("all refused: the same state plus the message, and the counter does not move", () => {
    const estado = base()
    const junto = aplicar(reductor(), estado, agregarValores(estado, ["rojo", "AZUL"]))
    expect(junto).toEqual({ ...estado, aviso: 'El valor "rojo" está repetido en Color; El valor "AZUL" está repetido en Color' })
    expect(junto.contador).toBe(estado.contador)
    expect(junto.opciones).toBe(estado.opciones)
  })

  it("a stale message is cleared when everything goes through", () => {
    const estado = aplicar(reductor(), base(), { tipo: "agregarOpcion", nombre: "" })
    expect(estado.aviso).not.toBeNull()
    expect(aplicar(reductor(), estado, agregarValores(estado, ["Verde", "Negro"])).aviso).toBeNull()
  })

  it("is applied over the latest state: what was dispatched before it is kept", () => {
    const estado = base()
    const reducir = crearReductor()
    const despues = [{ tipo: "cambiarCodigoBase", codigo: "ZZ" } as VariantesAccion, agregarValores(estado, ["rojo", "Verde"])].reduce(reducir, estado)
    expect(despues.codigoBase).toBe("ZZ")
    expect(textos(despues)).toEqual(["Rojo", "Azul", "Verde"])
    expect(despues.aviso).toBe('El valor "rojo" está repetido en Color')
  })

  it("new combinations follow the accepted values (two options)", () => {
    const inicial = hidratar(grupoColorTalle())
    const junto = aplicar(reductor(), inicial, { tipo: "agregarValores", opcionId: opcionId(inicial, "Color"), textos: ["Verde", "rojo"] })
    expect(filasEnOrden(junto)).toHaveLength(6)
    expect(etiquetas(junto)).toEqual(["Rojo / S", "Rojo / M", "Azul / S", "Azul / M", "Verde / S", "Verde / M"])
  })

  it("is pure and replay-stable: the same action on the same state gives the same state", () => {
    const estado = base()
    const accion = agregarValores(estado, ["rojo", "Verde", "Negro"])
    const a = crearReductor()(estado, accion)
    const b = crearReductor()(estado, accion)
    expect(a).toEqual(b)
    expect(estado.opciones[0].valores).toHaveLength(2)
  })

  it("an option that does not exist changes nothing", () => {
    const estado = base()
    expect(crearReductor()(estado, { tipo: "agregarValores", opcionId: "no-existe", textos: ["Verde"] })).toBe(estado)
  })

  it("an empty list changes nothing", () => {
    const estado = base()
    expect(crearReductor()(estado, agregarValores(estado, []))).toBe(estado)
  })
})
