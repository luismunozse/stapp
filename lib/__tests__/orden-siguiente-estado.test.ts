import { describe, it, expect } from "vitest"
import { siguienteEstado } from "@/lib/ordenes/siguiente-estado"
import { TRANSICIONES_VALIDAS, esTransicionValida } from "@/lib/orden-state-machine"
import type { EstadoOrden } from "@/types"

describe("siguienteEstado", () => {
  it("cada acción principal es una transición que el backend acepta", () => {
    for (const estado of Object.keys(TRANSICIONES_VALIDAS) as EstadoOrden[]) {
      const accion = siguienteEstado(estado)
      if (accion) expect(esTransicionValida(estado, accion.estado), `${estado} -> ${accion.estado}`).toBe(true)
    }
  })

  it("los estados terminales y cancelado no tienen acción principal", () => {
    for (const e of ["ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO", "CANCELADO"] as EstadoOrden[]) {
      expect(siguienteEstado(e)).toBeNull()
    }
  })

  it("el flujo normal avanza de a un paso", () => {
    expect(siguienteEstado("RECIBIDO")?.estado).toBe("EN_DIAGNOSTICO")
    expect(siguienteEstado("EN_REPARACION")?.estado).toBe("REPARADO")
    expect(siguienteEstado("REPARADO")?.estado).toBe("ENTREGADO")
  })
})
