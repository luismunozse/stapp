import { describe, it, expect } from "vitest"
import { renderHook } from "@testing-library/react"
import { useTipoDispositivoConfig } from "@/hooks/use-tipo-dispositivo-config"
import { FALLBACK_CONFIG } from "@/lib/tipos-dispositivo-defaults"

const tipos = [
  {
    codigo: "CELULAR",
    nombre: "Celular",
    config: {
      campos: { imei: { visible: true }, password: { visible: true }, color: { visible: true }, marca: { visible: true } },
      accesorios: [{ id: "cargador", label: "Cargador" }],
      problemasComunes: ["No enciende"],
      marcas: ["Apple", "Samsung"],
      camposExtra: [],
    },
  },
  { codigo: "CONSOLA", nombre: "Consola", config: { campos: { imei: { visible: false }, marca: { visible: false } } } },
  { codigo: "SIN_CONFIG", nombre: "Sin config", config: {} },
]

describe("useTipoDispositivoConfig", () => {
  it("devuelve los derivados del config del tipo seleccionado", () => {
    const { result } = renderHook(() => useTipoDispositivoConfig(tipos as any, "CELULAR"))
    expect(result.current.marcasDisponibles).toEqual(["Apple", "Samsung"])
    expect(result.current.accesoriosDisponibles).toEqual([{ id: "cargador", label: "Cargador" }])
    expect(result.current.showImei).toBe(true)
  })

  it("respeta la visibilidad en false", () => {
    const { result } = renderHook(() => useTipoDispositivoConfig(tipos as any, "CONSOLA"))
    expect(result.current.showImei).toBe(false)
    expect(result.current.showMarca).toBe(false)
    // password y color no vienen en el config de CONSOLA: por defecto deben ser visibles
    expect(result.current.showPassword).toBe(true)
    expect(result.current.showColor).toBe(true)
  })

  it("cae al FALLBACK_CONFIG cuando el tipo tiene config vacio", () => {
    const { result } = renderHook(() => useTipoDispositivoConfig(tipos as any, "SIN_CONFIG"))
    expect(result.current.config).toEqual(FALLBACK_CONFIG)
  })

  it("cae al FALLBACK_CONFIG cuando no hay tipo seleccionado", () => {
    const { result } = renderHook(() => useTipoDispositivoConfig(tipos as any, ""))
    expect(result.current.config).toEqual(FALLBACK_CONFIG)
  })
})
