import { describe, it, expect } from "vitest"
import { validarSeleccionRubro } from "@/lib/rubros/seleccion"

/**
 * El registro no puede dejar pasar una elección de rubro vacía ni un "Otro"
 * sin describir.
 *
 * El genérico está último en el selector a propósito, para que no sea la salida
 * fácil — pero durante un tiempo estuvo además PRESELECCIONADO, así que quien no
 * prestaba atención caía ahí sin escribir nada: sin pack, sin vocabulario y sin
 * checklist. Es el peor resultado posible y era el camino de menor resistencia.
 */

describe("validarSeleccionRubro", () => {
  it("exige elegir un rubro", () => {
    expect(validarSeleccionRubro("", "")).toBe("Elegí qué reparás")
    expect(validarSeleccionRubro(null, "")).toBe("Elegí qué reparás")
    expect(validarSeleccionRubro("   ", "")).toBe("Elegí qué reparás")
  })

  it("rechaza un rubro que no está en el registro", () => {
    expect(validarSeleccionRubro("plomeria", "")).toBe("Elegí qué reparás")
  })

  it("acepta un pack curado sin pedir detalle", () => {
    expect(validarSeleccionRubro("automotor", "")).toBeNull()
    expect(validarSeleccionRubro("electronica", "")).toBeNull()
    expect(validarSeleccionRubro("relojeria", "   ")).toBeNull()
  })

  it("exige el detalle cuando el rubro es el genérico", () => {
    expect(validarSeleccionRubro("generico", "")).toBe(
      "Contanos qué reparás para preparar tu cuenta"
    )
    expect(validarSeleccionRubro("generico", "    ")).toBe(
      "Contanos qué reparás para preparar tu cuenta"
    )
  })

  it("rechaza un detalle del que no sale nada usable", () => {
    expect(validarSeleccionRubro("generico", "###")).toBe(
      "Escribí qué reparás con palabras, por ejemplo: máquinas de café"
    )
    expect(validarSeleccionRubro("generico", "1")).toBe(
      "Escribí qué reparás con palabras, por ejemplo: máquinas de café"
    )
  })

  it("acepta el genérico con un detalle que deriva bien", () => {
    expect(validarSeleccionRubro("generico", "máquinas de café")).toBeNull()
    expect(validarSeleccionRubro("generico", "cerraduras")).toBeNull()
    expect(validarSeleccionRubro("generico", "cortadoras de pasto")).toBeNull()
  })

  it("ignora el detalle en los packs curados aunque sea basura", () => {
    expect(validarSeleccionRubro("automotor", "###")).toBeNull()
  })
})
