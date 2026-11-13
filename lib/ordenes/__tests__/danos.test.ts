import { describe, expect, it } from "vitest"
import {
  danoInputSchema,
  MAX_DANOS_POR_ORDEN,
  mensajeErrorDanos,
  validarDanosParaTipo,
  type DanoInput,
} from "../danos"

const base: DanoInput = { diagrama: "celular@1", vista: "frente", x: 0.5, y: 0.5, tipo: "golpe" }

describe("danoInputSchema", () => {
  it("acepta un daño válido", () => {
    expect(danoInputSchema.safeParse({ diagrama: "celular@1", vista: "frente", x: 0, y: 1, tipo: "golpe" }).success).toBe(true)
  })
  it.each([
    ["x < 0", { x: -0.01 }],
    ["y > 1", { y: 1.01 }],
    ["tipo inválido", { tipo: "quemado" }],
    ["vista inválida", { vista: "arriba" }],
    ["nota de 201 caracteres", { nota: "a".repeat(201) }],
  ])("rechaza %s", (_n, patch) => {
    expect(danoInputSchema.safeParse({ ...base, ...patch }).success).toBe(false)
  })
})

describe("validarDanosParaTipo", () => {
  it("acepta daños que corresponden al tipo", () => {
    expect(validarDanosParaTipo([base], "CELULAR")).toEqual({ ok: true })
  })
  it("rechaza diagrama que no corresponde al tipo", () => {
    const r = validarDanosParaTipo([{ ...base, diagrama: "tablet@1" }], "CELULAR")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("no corresponde")
  })
  it("rechaza vista inexistente en el diagrama", () => {
    expect(validarDanosParaTipo([{ ...base, vista: "lateral" }], "CELULAR").ok).toBe(false)
  })
  it("rechaza más de 30 daños", () => {
    const r = validarDanosParaTipo(Array.from({ length: MAX_DANOS_POR_ORDEN + 1 }, () => base), "CELULAR")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("30")
  })
})

describe("mensajeErrorDanos", () => {
  const e = (message: string) => ({ code: "P0001", message })
  it.each([
    ["DANOS_ORDEN_CERRADA", 409, "La orden ya está cerrada"],
    ["DANOS_DIAGNOSTICO_FUERA_DE_VENTANA", 409, "Pasaron más de 10 minutos; el daño ya no se puede borrar"],
    ["DANOS_LIMITE", 422, "Máximo 30 daños por orden"],
    ["DANOS_ORDEN_NO_ENCONTRADA", 404, "Orden no encontrada"],
    ["DANOS_RECEPCION_YA_REGISTRADA", 409, "El estado físico de la recepción ya fue registrado"],
    ["DANOS_RECEPCION_FUERA_DE_VENTANA", 409, "La recepción ya no admite registrar el estado físico"],
    ["DANOS_RECEPCION_INMUTABLE", 409, "Los daños de la recepción no se pueden modificar ni borrar"],
    ["DANOS_SIN_DANOS_CON_PINS", 409, "No se puede marcar \"sin daños\" si hay daños marcados"],
  ])("%s", (token, status, error) => {
    expect(mensajeErrorDanos(e(`${token}: detalle extra`))).toEqual({ status, error })
  })
  it("otro error da 500", () => {
    expect(mensajeErrorDanos(new Error("boom"))).toEqual({ status: 500, error: "No se pudo guardar el estado físico" })
    expect(mensajeErrorDanos(null).status).toBe(500)
  })
  it("el 500 de borrar habla de quitar, no de guardar", () => {
    expect(mensajeErrorDanos(new Error("boom"), "quitar")).toEqual({ status: 500, error: "No pudimos quitar el daño. Probá de nuevo." })
    expect(mensajeErrorDanos(e("DANOS_ORDEN_CERRADA"), "quitar")).toEqual({ status: 409, error: "La orden ya está cerrada" })
  })
})
