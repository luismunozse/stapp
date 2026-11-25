import { describe, it, expect, vi, afterEach } from "vitest"
import {
  apiFetch,
  leerError,
  mensajeDeError,
  mensajeDeExcepcion,
  mensajeDeRespuesta,
  MENSAJE_SIN_CONEXION,
} from "@/lib/errores-cliente"

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("mensajeDeRespuesta", () => {
  it("sesión vencida, suscripción, permisos y límite de requests", () => {
    expect(mensajeDeRespuesta(401, { error: "No autorizado" })).toContain("sesión venció")
    expect(mensajeDeRespuesta(402, { code: "SUBSCRIPTION_REQUIRED" })).toContain("suscripción")
    expect(mensajeDeRespuesta(403, null)).toContain("No tenés permiso")
    expect(mensajeDeRespuesta(429, null)).toContain("Demasiadas solicitudes")
  })

  it("errores de negocio: se muestra lo que explica el servidor", () => {
    expect(mensajeDeRespuesta(400, { error: "El cliente ya existe" })).toBe("El cliente ya existe")
    expect(mensajeDeRespuesta(409, { error: "Stock insuficiente" })).toBe("Stock insuficiente")
  })

  it("validación: nombra los campos", () => {
    expect(mensajeDeRespuesta(400, { error: "Datos inválidos", details: { telefono: ["Requerido"] } })).toBe(
      "Datos inválidos — telefono: Requerido"
    )
  })

  it("5xx sin ref: NO muestra el mensaje interno", () => {
    const m = mensajeDeRespuesta(500, { error: "canceling statement due to statement timeout" }, "No se pudo guardar")
    expect(m).not.toContain("statement")
    expect(m).toContain("No se pudo guardar")
  })

  it("5xx con ref: muestra el mensaje seguro y el código para soporte", () => {
    const m = mensajeDeRespuesta(500, { error: "No se pudo guardar la configuración.", ref: "E-ABCDEF" })
    expect(m).toContain("No se pudo guardar la configuración.")
    expect(m).toContain("E-ABCDEF")
  })
})

describe("mensajeDeExcepcion / mensajeDeError", () => {
  it("fetch caído: sin conexión, no 'Failed to fetch'", () => {
    expect(mensajeDeExcepcion(new TypeError("Failed to fetch"))).toBe(MENSAJE_SIN_CONEXION)
    expect(mensajeDeError(new TypeError("Failed to fetch"), "Error al abrir caja")).toBe(MENSAJE_SIN_CONEXION)
  })

  it("respuesta que no era JSON: no muestra 'Unexpected token'", () => {
    const m = mensajeDeError(new SyntaxError("Unexpected token < in JSON at position 0"), "Error al abrir caja")
    expect(m).not.toContain("Unexpected")
    expect(m).toContain("Error al abrir caja")
  })

  it("un error lanzado a propósito se muestra tal cual", () => {
    expect(mensajeDeError(new Error("La caja ya está abierta"), "Error al abrir caja")).toBe("La caja ya está abierta")
    expect(mensajeDeError(null, "Error al abrir caja")).toBe("Error al abrir caja")
  })
})

describe("leerError / apiFetch", () => {
  afterEach(() => vi.restoreAllMocks())

  it("leerError tolera un 500 en HTML", async () => {
    const res = new Response("<html>500</html>", { status: 500, headers: { "content-type": "text/html" } })
    expect(await leerError(res, "Error al cerrar caja")).toContain("Error al cerrar caja")
  })

  it("apiFetch: éxito", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { id: 1 })))
    expect(await apiFetch("/api/x")).toEqual({ ok: true, data: { id: 1 }, status: 200 })
    vi.unstubAllGlobals()
  })

  it("apiFetch: error del servidor con código", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, { error: "No se pudo guardar.", ref: "E-ABCDEF" })))
    const r = await apiFetch("/api/x")
    expect(r).toMatchObject({ ok: false, status: 500, ref: "E-ABCDEF" })
    vi.unstubAllGlobals()
  })

  it("apiFetch: nunca lanza si no hay red", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch") }))
    expect(await apiFetch("/api/x")).toMatchObject({ ok: false, status: 0, mensaje: MENSAJE_SIN_CONEXION })
    vi.unstubAllGlobals()
  })
})
