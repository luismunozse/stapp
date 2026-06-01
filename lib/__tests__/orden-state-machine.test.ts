import { describe, it, expect } from "vitest"
import {
  esTransicionValida,
  getTransicionesPosibles,
  getMensajeTransicionInvalida,
  validarCamposRequeridos,
  TRANSICIONES_VALIDAS,
  ESTADO_LABELS,
} from "../orden-state-machine"
import type { EstadoOrden } from "@/types"

describe("orden-state-machine", () => {
  describe("esTransicionValida", () => {
    it("permite transición RECIBIDO -> EN_DIAGNOSTICO", () => {
      expect(esTransicionValida("RECIBIDO", "EN_DIAGNOSTICO")).toBe(true)
    })

    it("permite transición RECIBIDO -> PRESUPUESTADO (saltar diagnóstico)", () => {
      expect(esTransicionValida("RECIBIDO", "PRESUPUESTADO")).toBe(true)
    })

    it("permite transición RECIBIDO -> EN_REPARACION (presupuesto aceptado al ingreso)", () => {
      expect(esTransicionValida("RECIBIDO", "EN_REPARACION")).toBe(true)
    })

    it("permite transición RECIBIDO -> CANCELADO", () => {
      expect(esTransicionValida("RECIBIDO", "CANCELADO")).toBe(true)
    })

    it("permite transición RECIBIDO -> SIN_REPARACION", () => {
      expect(esTransicionValida("RECIBIDO", "SIN_REPARACION")).toBe(true)
    })

    it("rechaza transición RECIBIDO -> ENTREGADO (no puede saltar todo el flujo)", () => {
      expect(esTransicionValida("RECIBIDO", "ENTREGADO")).toBe(false)
    })

    it("rechaza transición RECIBIDO -> REPARADO", () => {
      expect(esTransicionValida("RECIBIDO", "REPARADO")).toBe(false)
    })

    it("permite transición PRESUPUESTADO -> APROBADO", () => {
      expect(esTransicionValida("PRESUPUESTADO", "APROBADO")).toBe(true)
    })

    it("rechaza transición PRESUPUESTADO -> EN_REPARACION (debe pasar por APROBADO)", () => {
      expect(esTransicionValida("PRESUPUESTADO", "EN_REPARACION")).toBe(false)
    })

    it("permite transición EN_REPARACION -> ESPERANDO_REPUESTO", () => {
      expect(esTransicionValida("EN_REPARACION", "ESPERANDO_REPUESTO")).toBe(true)
    })

    it("permite transición ESPERANDO_REPUESTO -> EN_REPARACION (volver a reparar)", () => {
      expect(esTransicionValida("ESPERANDO_REPUESTO", "EN_REPARACION")).toBe(true)
    })

    it("permite transición EN_REPARACION -> REPARADO", () => {
      expect(esTransicionValida("EN_REPARACION", "REPARADO")).toBe(true)
    })

    it("permite transición REPARADO -> ENTREGADO", () => {
      expect(esTransicionValida("REPARADO", "ENTREGADO")).toBe(true)
    })

    it("permite transición REPARADO -> EN_REPARACION (detectó falla post-reparación)", () => {
      expect(esTransicionValida("REPARADO", "EN_REPARACION")).toBe(true)
    })

    it("rechaza cualquier transición desde ENTREGADO (estado terminal)", () => {
      expect(esTransicionValida("ENTREGADO", "RECIBIDO")).toBe(false)
      expect(esTransicionValida("ENTREGADO", "EN_REPARACION")).toBe(false)
      expect(esTransicionValida("ENTREGADO", "CANCELADO")).toBe(false)
    })

    it("permite reactivar desde CANCELADO -> RECIBIDO", () => {
      expect(esTransicionValida("CANCELADO", "RECIBIDO")).toBe(true)
    })

    it("rechaza transición CANCELADO -> EN_REPARACION", () => {
      expect(esTransicionValida("CANCELADO", "EN_REPARACION")).toBe(false)
    })

    it("permite reactivar desde SIN_REPARACION -> RECIBIDO", () => {
      expect(esTransicionValida("SIN_REPARACION", "RECIBIDO")).toBe(true)
    })

    it("retorna true cuando estado actual y nuevo son iguales", () => {
      expect(esTransicionValida("RECIBIDO", "RECIBIDO")).toBe(true)
      expect(esTransicionValida("ENTREGADO", "ENTREGADO")).toBe(true)
    })

    it("rechaza transición APROBADO -> PRESUPUESTADO (no puede retroceder)", () => {
      expect(esTransicionValida("APROBADO", "PRESUPUESTADO")).toBe(false)
    })
  })

  describe("getTransicionesPosibles", () => {
    it("retorna transiciones válidas desde RECIBIDO", () => {
      const transiciones = getTransicionesPosibles("RECIBIDO")
      expect(transiciones).toContain("EN_DIAGNOSTICO")
      expect(transiciones).toContain("PRESUPUESTADO")
      expect(transiciones).toContain("CANCELADO")
      expect(transiciones).not.toContain("ENTREGADO")
    })

    it("retorna array vacío para ENTREGADO (terminal)", () => {
      expect(getTransicionesPosibles("ENTREGADO")).toEqual([])
    })

    it("retorna solo RECIBIDO para CANCELADO", () => {
      const transiciones = getTransicionesPosibles("CANCELADO")
      expect(transiciones).toEqual(["RECIBIDO"])
    })

    it("retorna transiciones correctas para EN_REPARACION", () => {
      const transiciones = getTransicionesPosibles("EN_REPARACION")
      expect(transiciones).toContain("ESPERANDO_REPUESTO")
      expect(transiciones).toContain("REPARADO")
      expect(transiciones).toContain("CANCELADO")
      expect(transiciones).toContain("SIN_REPARACION")
    })
  })

  describe("getMensajeTransicionInvalida", () => {
    it("incluye el estado actual y nuevo en el mensaje", () => {
      const msg = getMensajeTransicionInvalida("RECIBIDO", "ENTREGADO")
      expect(msg).toContain("RECIBIDO")
      expect(msg).toContain("ENTREGADO")
    })

    it("indica que no puede cambiar cuando es terminal", () => {
      const msg = getMensajeTransicionInvalida("ENTREGADO", "RECIBIDO")
      expect(msg).toContain("no puede cambiar")
    })

    it("lista las transiciones permitidas", () => {
      const msg = getMensajeTransicionInvalida("PRESUPUESTADO", "EN_REPARACION")
      expect(msg).toContain("APROBADO")
    })
  })

  describe("validarCamposRequeridos", () => {
    it("requiere presupuesto para PRESUPUESTADO", () => {
      const error = validarCamposRequeridos("PRESUPUESTADO", { presupuesto: null })
      expect(error).not.toBeNull()
      expect(error).toContain("Presupuesto")
    })

    it("permite PRESUPUESTADO con presupuesto definido", () => {
      const error = validarCamposRequeridos("PRESUPUESTADO", { presupuesto: 5000 })
      expect(error).toBeNull()
    })

    it("rechaza presupuesto en 0", () => {
      const error = validarCamposRequeridos("PRESUPUESTADO", { presupuesto: 0 })
      expect(error).not.toBeNull()
    })

    it("requiere costo final (presupuesto aceptado) para EN_REPARACION cuando no hay técnico ni costo", () => {
      // tecnico_id ya no es un campo requerido por la state machine; solo costo_final lo es.
      const error = validarCamposRequeridos("EN_REPARACION", { tecnico_id: null, costo_final: null })
      expect(error).not.toBeNull()
      expect(error).toContain("Costo final")
    })

    it("requiere costo final para EN_REPARACION", () => {
      const error = validarCamposRequeridos("EN_REPARACION", { tecnico_id: "t1", costo_final: null })
      expect(error).not.toBeNull()
      expect(error).toContain("Costo final")
    })

    it("permite EN_REPARACION con técnico y costo final", () => {
      const error = validarCamposRequeridos("EN_REPARACION", { tecnico_id: "t1", costo_final: 5000 })
      expect(error).toBeNull()
    })

    it("requiere costo final para REPARADO", () => {
      const error = validarCamposRequeridos("REPARADO", { costo_final: null })
      expect(error).not.toBeNull()
      expect(error).toContain("Costo final")
    })

    it("permite REPARADO con costo final", () => {
      const error = validarCamposRequeridos("REPARADO", { costo_final: 10000 })
      expect(error).toBeNull()
    })

    it("rechaza costo final en 0", () => {
      const error = validarCamposRequeridos("REPARADO", { costo_final: 0 })
      expect(error).not.toBeNull()
    })

    it("permite costo final como string numérico (desde DB)", () => {
      const error = validarCamposRequeridos("REPARADO", { costo_final: "5000" })
      expect(error).toBeNull()
    })

    it("retorna null para estados sin campos requeridos", () => {
      expect(validarCamposRequeridos("RECIBIDO", {})).toBeNull()
      expect(validarCamposRequeridos("EN_DIAGNOSTICO", {})).toBeNull()
      expect(validarCamposRequeridos("APROBADO", {})).toBeNull()
      expect(validarCamposRequeridos("ENTREGADO", {})).toBeNull()
      expect(validarCamposRequeridos("CANCELADO", {})).toBeNull()
    })
  })

  describe("TRANSICIONES_VALIDAS", () => {
    it("tiene todos los estados definidos", () => {
      const todosLosEstados: EstadoOrden[] = [
        "RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO",
        "EN_REPARACION", "ESPERANDO_REPUESTO", "REPARADO",
        "ENTREGADO", "CANCELADO", "SIN_REPARACION",
      ]
      for (const estado of todosLosEstados) {
        expect(TRANSICIONES_VALIDAS).toHaveProperty(estado)
      }
    })

    it("no tiene transiciones circulares a sí mismo", () => {
      for (const [estado, transiciones] of Object.entries(TRANSICIONES_VALIDAS)) {
        expect(transiciones).not.toContain(estado)
      }
    })
  })

  describe("ESTADO_LABELS", () => {
    it("tiene label para todos los estados", () => {
      const todosLosEstados: EstadoOrden[] = [
        "RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO",
        "EN_REPARACION", "ESPERANDO_REPUESTO", "REPARADO",
        "ENTREGADO", "CANCELADO", "SIN_REPARACION",
      ]
      for (const estado of todosLosEstados) {
        expect(ESTADO_LABELS[estado]).toBeDefined()
        expect(typeof ESTADO_LABELS[estado]).toBe("string")
        expect(ESTADO_LABELS[estado].length).toBeGreaterThan(0)
      }
    })
  })
})
