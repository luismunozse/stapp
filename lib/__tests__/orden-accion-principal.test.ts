import { describe, it, expect } from "vitest"
import { accionPrincipalOrden, type EntradaAccionPrincipal } from "@/lib/ordenes/accion-principal"
import { TRANSICIONES_VALIDAS, esTransicionValida } from "@/lib/orden-state-machine"
import type { EstadoOrden } from "@/types"

const ESTADOS = Object.keys(TRANSICIONES_VALIDAS) as EstadoOrden[]

function accion(over: Partial<EntradaAccionPrincipal>) {
  return accionPrincipalOrden({
    estado: "RECIBIDO",
    rol: "ADMIN",
    asignadaAMi: false,
    puedeTomar: false,
    puedeCobrarSaldo: false,
    ...over,
  })
}

/** Lo que dice el botón principal, o null. */
function principal(over: Partial<EntradaAccionPrincipal>) {
  return accion(over).principal?.label ?? null
}

describe("accionPrincipalOrden: mostrador (ADMIN y VENDEDOR)", () => {
  it.each([
    ["RECIBIDO", "Empezar diagnóstico", "EN_DIAGNOSTICO"],
    ["EN_DIAGNOSTICO", "Pasar a presupuestado", "PRESUPUESTADO"],
    ["PRESUPUESTADO", "Registrar aprobación", "APROBADO"],
    ["APROBADO", "Empezar reparación", "EN_REPARACION"],
    ["EN_REPARACION", "Marcar reparado", "REPARADO"],
    ["ESPERANDO_REPUESTO", "Seguir reparación", "EN_REPARACION"],
    ["REPARADO", "Entregar", "ENTREGADO"],
    ["SIN_FALLA_DETECTADA", "Entregar", "ENTREGADO"],
    ["SIN_REPARACION", "Entregar sin reparar", "ENTREGADO_SIN_REPARACION"],
  ] as const)("%s → %s", (estado, label, destino) => {
    for (const rol of ["ADMIN", "VENDEDOR"]) {
      const r = accion({ estado, rol })
      expect(r.principal).toEqual({ tipo: "estado", estado: destino, label })
      expect(r.puedeCambiarEstado).toBe(true)
    }
  })

  it("con saldo, Cobrar va como secundaria al lado del paso siguiente", () => {
    const r = accion({ estado: "REPARADO", puedeCobrarSaldo: true })
    expect(r.principal?.label).toBe("Entregar")
    expect(r.cobrarSecundario).toBe(true)
  })

  it("en un estado final con saldo, Cobrar es la principal", () => {
    for (const estado of ["ENTREGADO", "ENTREGADO_SIN_REPARACION"] as EstadoOrden[]) {
      const r = accion({ estado, puedeCobrarSaldo: true })
      expect(r.principal).toEqual({ tipo: "cobrar", label: "Cobrar" })
      expect(r.cobrarSecundario).toBe(false)
    }
  })

  it("en un estado final sin saldo no hay acción", () => {
    for (const estado of ["ENTREGADO", "ENTREGADO_SIN_COBRO", "ENTREGADO_SIN_REPARACION", "CANCELADO"] as EstadoOrden[]) {
      expect(accion({ estado }).principal).toBeNull()
    }
  })
})

describe("accionPrincipalOrden: TECNICO", () => {
  it("con la orden asignada, empuja los pasos del taller", () => {
    expect(principal({ rol: "TECNICO", asignadaAMi: true, estado: "RECIBIDO" })).toBe("Empezar diagnóstico")
    expect(principal({ rol: "TECNICO", asignadaAMi: true, estado: "EN_DIAGNOSTICO" })).toBe("Pasar a presupuestado")
    expect(principal({ rol: "TECNICO", asignadaAMi: true, estado: "APROBADO" })).toBe("Empezar reparación")
    expect(principal({ rol: "TECNICO", asignadaAMi: true, estado: "EN_REPARACION" })).toBe("Marcar reparado")
    expect(principal({ rol: "TECNICO", asignadaAMi: true, estado: "ESPERANDO_REPUESTO" })).toBe("Seguir reparación")
  })

  it("la aprobación del cliente y la entrega quedan para el mostrador", () => {
    for (const estado of ["PRESUPUESTADO", "REPARADO", "SIN_FALLA_DETECTADA", "SIN_REPARACION"] as EstadoOrden[]) {
      const r = accion({ rol: "TECNICO", asignadaAMi: true, estado })
      expect(r.principal, estado).toBeNull()
      // Sigue pudiendo cambiar el estado desde "Más estados…".
      expect(r.puedeCambiarEstado).toBe(true)
    }
  })

  it("nunca cobra, aunque haya saldo", () => {
    const r = accion({ rol: "TECNICO", asignadaAMi: true, estado: "ENTREGADO", puedeCobrarSaldo: true })
    expect(r.principal).toBeNull()
    expect(r.cobrarSecundario).toBe(false)
    expect(accion({ rol: "TECNICO", asignadaAMi: true, estado: "EN_REPARACION", puedeCobrarSaldo: true }).cobrarSecundario).toBe(false)
  })

  it("sin la orden asignada no cambia el estado; si puede, la toma", () => {
    for (const estado of ESTADOS) {
      const sinTomar = accion({ rol: "TECNICO", estado })
      expect(sinTomar.principal).toBeNull()
      expect(sinTomar.puedeCambiarEstado).toBe(false)
      expect(accion({ rol: "TECNICO", estado, puedeTomar: true }).principal).toEqual({ tipo: "tomar", label: "Tomar orden" })
    }
  })
})

describe("accionPrincipalOrden: invariantes", () => {
  it("todo cambio de estado ofrecido es una transición que la API acepta, para cualquier rol", () => {
    for (const estado of ESTADOS) {
      for (const rol of ["ADMIN", "VENDEDOR", "TECNICO"]) {
        const p = accion({ estado, rol, asignadaAMi: true, puedeCobrarSaldo: true }).principal
        if (p?.tipo === "estado") expect(esTransicionValida(estado, p.estado), `${rol} ${estado} -> ${p.estado}`).toBe(true)
      }
    }
  })

  it("solo un técnico ve Tomar orden", () => {
    for (const rol of ["ADMIN", "VENDEDOR"]) {
      expect(accion({ rol, puedeTomar: true }).principal?.tipo).toBe("estado")
    }
  })
})
