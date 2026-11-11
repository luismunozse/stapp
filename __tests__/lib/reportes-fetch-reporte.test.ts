import { describe, it, expect, vi, afterEach } from "vitest"
import {
  fetchReporte,
  MENSAJE_ERROR_REPORTE,
  MENSAJE_SIN_CONEXION,
} from "@/lib/reportes/fetch-reporte"

function stubRespuesta(status: number, body: unknown) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("fetchReporte", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("un 403 FEATURE_REQUIRED es un bloqueo de plan, no un error", async () => {
    stubRespuesta(403, {
      error: "Este reporte requiere el plan Profesional",
      code: "FEATURE_REQUIRED",
      feature: "advanced_reports",
    })
    await expect(fetchReporte("/api/reportes/fallas-comunes")).resolves.toEqual({ estado: "bloqueado" })
  })

  it("un 403 sin ese code (permiso de rol) sigue siendo un error", async () => {
    stubRespuesta(403, { error: "No autorizado" })
    await expect(fetchReporte("/api/reportes/x")).resolves.toEqual({
      estado: "error",
      mensaje: "No autorizado",
    })
  })

  it("un 500 es un error con el mensaje de la API", async () => {
    stubRespuesta(500, { error: "Error al obtener datos" })
    await expect(fetchReporte("/api/reportes/x")).resolves.toEqual({
      estado: "error",
      mensaje: "Error al obtener datos",
    })
  })

  it("un 500 sin cuerpo JSON cae al mensaje genérico", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("boom", { status: 500 }))))
    await expect(fetchReporte("/api/reportes/x")).resolves.toEqual({
      estado: "error",
      mensaje: MENSAJE_ERROR_REPORTE,
    })
  })

  it("si la red falla, avisa que revise la conexión", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))))
    await expect(fetchReporte("/api/reportes/x")).resolves.toEqual({
      estado: "error",
      mensaje: MENSAJE_SIN_CONEXION,
    })
  })

  it("un 200 devuelve el cuerpo tal cual", async () => {
    const fetchMock = stubRespuesta(200, { data: [{ falla: "Pantalla", cantidad: 3 }] })
    await expect(fetchReporte("/api/reportes/fallas-comunes")).resolves.toEqual({
      estado: "ok",
      data: { data: [{ falla: "Pantalla", cantidad: 3 }] },
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/reportes/fallas-comunes", undefined)
  })
})
