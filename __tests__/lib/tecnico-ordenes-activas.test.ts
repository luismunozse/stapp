/**
 * The sentence that says how many open orders a technician holds when an ADMIN is about to deactivate him,
 * and where they are: the total (every branch) against the part in the scope the ADMIN works in.
 */
import { describe, it, expect } from "vitest"
import { avisoDeOrdenesActivas } from "@/lib/tecnico-ordenes-activas"

describe("avisoDeOrdenesActivas", () => {
  it("says nothing when he holds no open order anywhere", () => {
    expect(avisoDeOrdenesActivas(0, 0, "Aún tiene")).toBeNull()
  })

  it("all of them in the scope: the plain advice", () => {
    expect(avisoDeOrdenesActivas(3, 3, "Aún tiene")).toBe("Aún tiene 3 orden(es) activa(s). Considerá reasignarlas.")
    expect(avisoDeOrdenesActivas(7, 7, "El técnico tiene")).toBe("El técnico tiene 7 orden(es) activa(s). Considerá reasignarlas.")
  })

  it("none in the scope (the jed-electronics case): all of them belong to other branches", () => {
    expect(avisoDeOrdenesActivas(7, 0, "Aún tiene")).toBe(
      "Aún tiene 7 orden(es) activa(s), todas de otras sucursales. Considerá reasignarlas: las de otras sucursales se mueven eligiendo esa sucursal en el selector.",
    )
  })

  it("some in the scope and some elsewhere: says how many of each", () => {
    expect(avisoDeOrdenesActivas(5, 2, "Aún tiene")).toBe(
      "Aún tiene 5 orden(es) activa(s) (2 de esta sucursal y 3 de otras). Considerá reasignarlas: las de otras sucursales se mueven eligiendo esa sucursal en el selector.",
    )
  })

  it("a scoped count above the total (two reads a moment apart) is taken as all of them", () => {
    expect(avisoDeOrdenesActivas(2, 3, "Aún tiene")).toBe("Aún tiene 2 orden(es) activa(s). Considerá reasignarlas.")
  })

  it("an unknown scoped count (the screen has none) is taken as all of them", () => {
    expect(avisoDeOrdenesActivas(4, undefined, "Aún tiene")).toBe("Aún tiene 4 orden(es) activa(s). Considerá reasignarlas.")
  })
})
