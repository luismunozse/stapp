import { describe, it, expect } from "vitest"
import {
  renderTemplate,
  resolvePlantilla,
  getPlantilla,
  PLANTILLAS_CATALOG,
} from "@/lib/whatsapp/plantillas-catalog"

describe("renderTemplate", () => {
  it("reemplaza variables {var} con valores del contexto", () => {
    const out = renderTemplate("Hola {cliente}, orden #{numero}.", {
      cliente: "Juan",
      numero: 42,
    })
    expect(out).toBe("Hola Juan, orden #42.")
  })

  it("deja vacías las variables ausentes en el contexto", () => {
    const out = renderTemplate("Hola {cliente}, presupuesto {presupuesto}.", {
      cliente: "Juan",
    })
    expect(out).toBe("Hola Juan, presupuesto .")
  })

  it("trata null/undefined como string vacío", () => {
    const out = renderTemplate("X{a}Y", { a: null })
    expect(out).toBe("XY")
  })

  it("colapsa 3+ saltos de línea consecutivos a 2", () => {
    const out = renderTemplate("línea1\n\n\n\nlínea2", {})
    expect(out).toBe("línea1\n\nlínea2")
  })

  it("hace trim del resultado final", () => {
    const out = renderTemplate("  hola  ", {})
    expect(out).toBe("hola")
  })

  it("soporta variables con números y guiones bajos en el nombre", () => {
    const out = renderTemplate("{var_1} {var2}", { var_1: "a", var2: "b" })
    expect(out).toBe("a b")
  })
})

describe("resolvePlantilla", () => {
  it("usa el defaultText cuando no hay override", () => {
    const out = resolvePlantilla(
      "orden_estado_actual",
      { cliente: "Juan", dispositivo: "iPhone", numero_orden: "1", estado: "recibido", empresa: "ACME", link_seguimiento: "" },
      null,
    )
    expect(out).toContain("Juan")
    expect(out).toContain("iPhone")
    expect(out).toContain("recibido")
    expect(out).toContain("ACME")
  })

  it("usa el override del usuario cuando existe", () => {
    const out = resolvePlantilla(
      "orden_estado_actual",
      { cliente: "Juan", estado: "listo" },
      { orden_estado_actual: "CUSTOM: {cliente} - {estado}" },
    )
    expect(out).toBe("CUSTOM: Juan - listo")
  })

  it("cae al default si el override es string vacío o solo whitespace", () => {
    const out = resolvePlantilla(
      "orden_estado_actual",
      { cliente: "Juan", dispositivo: "X", numero_orden: "1", estado: "listo", empresa: "ACME", link_seguimiento: "" },
      { orden_estado_actual: "   " },
    )
    expect(out).toContain("Juan")
    expect(out).not.toBe("   ")
  })

  it("retorna string vacío si la key no existe en el catálogo y no hay override", () => {
    const out = resolvePlantilla("key_inexistente_zzz", { cliente: "Juan" }, null)
    expect(out).toBe("")
  })

  it("usa el override aunque la key no esté en el catálogo", () => {
    const out = resolvePlantilla(
      "key_inexistente_zzz",
      { cliente: "Juan" },
      { key_inexistente_zzz: "Hola {cliente}" },
    )
    expect(out).toBe("Hola Juan")
  })
})

describe("getPlantilla", () => {
  it("retorna la plantilla por su key", () => {
    const p = getPlantilla("orden_estado_actual")
    expect(p).toBeDefined()
    expect(p?.key).toBe("orden_estado_actual")
    expect(p?.category).toBe("ordenes")
  })

  it("retorna undefined para keys inexistentes", () => {
    expect(getPlantilla("inexistente_xyz")).toBeUndefined()
  })
})

describe("PLANTILLAS_CATALOG integridad", () => {
  it("todas las keys del catálogo son únicas", () => {
    const keys = PLANTILLAS_CATALOG.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("toda variable referenciada en defaultText está declarada en variables[]", () => {
    const offenders: string[] = []
    for (const p of PLANTILLAS_CATALOG) {
      const declared = new Set(p.variables.map((v) => v.key))
      const used = new Set<string>()
      const re = /\{(\w+)\}/g
      let m
      while ((m = re.exec(p.defaultText)) !== null) used.add(m[1])
      for (const u of used) {
        if (!declared.has(u)) offenders.push(`${p.key}: usa {${u}} pero no está en variables[]`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("todas las plantillas tienen defaultText no vacío", () => {
    const empties = PLANTILLAS_CATALOG.filter((p) => !p.defaultText.trim())
    expect(empties.map((p) => p.key)).toEqual([])
  })

  it("incluye las keys nuevas agregadas en esta sesión", () => {
    const keys = PLANTILLAS_CATALOG.map((p) => p.key)
    expect(keys).toContain("orden_recepcion")
    expect(keys).toContain("catalogo_carrito_abandonado_recovery")
    expect(keys).toContain("catalogo_solicitud_taller")
    expect(keys).toContain("seguimiento_consulta_cliente")
  })

  it("incluye las 12 plantillas por estado individual (orden_estado_<estado>)", () => {
    const keys = PLANTILLAS_CATALOG.map((p) => p.key)
    const estados = [
      "recibido",
      "en_diagnostico",
      "presupuestado",
      "aprobado",
      "en_reparacion",
      "esperando_repuesto",
      "reparado",
      "entregado",
      "entregado_sin_reparacion",
      "entregado_sin_cobro",
      "cancelado",
      "sin_reparacion",
    ]
    for (const e of estados) {
      expect(keys).toContain(`orden_estado_${e}`)
    }
  })
})
