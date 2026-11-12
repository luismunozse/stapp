import { describe, it, expect } from "vitest"
import { debeVerAvisoCambioPolitica, FECHA_CAMBIO_POLITICA_TRIAL } from "@/lib/politica-trial"

describe("debeVerAvisoCambioPolitica", () => {
  it("lo ve una cuenta creada antes del cambio de política", () => {
    expect(debeVerAvisoCambioPolitica("2025-11-03T12:00:00Z")).toBe(true)
    expect(debeVerAvisoCambioPolitica(new Date(FECHA_CAMBIO_POLITICA_TRIAL.getTime() - 1))).toBe(true)
  })

  it("no lo ve una cuenta creada desde el cambio: aceptó la política vigente al registrarse", () => {
    expect(debeVerAvisoCambioPolitica(FECHA_CAMBIO_POLITICA_TRIAL)).toBe(false)
    expect(debeVerAvisoCambioPolitica("2026-11-11T09:00:00Z")).toBe(false)
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["vacía", ""],
    ["inválida", "no-es-fecha"],
  ])("sin fecha de creación (%s) no se muestra", (_caso, valor) => {
    expect(debeVerAvisoCambioPolitica(valor as string | null | undefined)).toBe(false)
  })
})
