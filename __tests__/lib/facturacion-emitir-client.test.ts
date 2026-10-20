// __tests__/lib/facturacion-emitir-client.test.ts
/**
 * Cliente compartido de emision (POS + detalle de venta). Los mensajes y el
 * mapeo status -> resultado son los que el POS ya tenia inline: este test los
 * fija para que el refactor no cambie lo que ve el usuario.
 */
import { describe, it, expect, vi } from "vitest"
import { emitirComprobanteArca } from "@/lib/facturacion/emitir-comprobante-client"

function respuesta(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ status, json: async () => body })
}

const COMPROBANTE = { id: "c1", tipo: "B", numero: "0001-00000007", cae: "123" }

describe("emitirComprobanteArca", () => {
  it("POSTea { ventaId } al endpoint de emision", async () => {
    const fetchImpl = respuesta(200, { comprobante: COMPROBANTE })
    await emitirComprobanteArca("v1", fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith("/api/facturacion-electronica/emitir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ventaId: "v1" }),
    })
  })

  it("200 -> ok con el comprobante", async () => {
    const r = await emitirComprobanteArca("v1", respuesta(200, { comprobante: COMPROBANTE }))
    expect(r).toEqual({ kind: "ok", comprobante: COMPROBANTE })
  })

  it("200 sin comprobante -> ok con null", async () => {
    const r = await emitirComprobanteArca("v1", respuesta(200, {}))
    expect(r).toEqual({ kind: "ok", comprobante: null })
  })

  it("409 con comprobante -> yaEmitido marcando el comprobante existente", async () => {
    const r = await emitirComprobanteArca("v1", respuesta(409, { comprobante: COMPROBANTE, error: "ya" }))
    expect(r).toEqual({
      kind: "yaEmitido",
      comprobante: { ...COMPROBANTE, yaEmitido: true },
      message: "ya",
    })
  })

  it("409 sin comprobante -> yaEmitido con comprobante null y el mensaje del servidor", async () => {
    const r = await emitirComprobanteArca("v1", respuesta(409, { error: "La venta ya no se puede facturar" }))
    expect(r).toEqual({ kind: "yaEmitido", comprobante: null, message: "La venta ya no se puede facturar" })
  })

  it("422 prefiere el error_msg del comprobante rechazado", async () => {
    const r = await emitirComprobanteArca(
      "v1",
      respuesta(422, { comprobante: { error_msg: "CUIT invalido" }, error: "otro" })
    )
    expect(r).toEqual({ kind: "error", message: "CUIT invalido" })
  })

  it("422 sin comprobante usa data.error y luego el texto por defecto", async () => {
    expect(await emitirComprobanteArca("v1", respuesta(422, { error: "Rechazado" }))).toEqual({
      kind: "error",
      message: "Rechazado",
    })
    expect(await emitirComprobanteArca("v1", respuesta(422, {}))).toEqual({
      kind: "error",
      message: "No se pudo emitir el comprobante",
    })
  })

  it("403 -> mensaje de facturacion no disponible", async () => {
    const r = await emitirComprobanteArca("v1", respuesta(403, { error: "x" }))
    expect(r).toEqual({
      kind: "error",
      message: "Facturación electrónica no disponible. Configurá facturación electrónica en Ajustes.",
    })
  })

  it("500 -> data.error o texto por defecto", async () => {
    expect(await emitirComprobanteArca("v1", respuesta(500, { error: "Se cayo" }))).toEqual({
      kind: "error",
      message: "Se cayo",
    })
    expect(await emitirComprobanteArca("v1", respuesta(500, {}))).toEqual({
      kind: "error",
      message: "No se pudo emitir el comprobante",
    })
  })

  it("cuerpo no JSON no rompe: se trata como cuerpo vacio", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => {
        throw new Error("bad json")
      },
    })
    expect(await emitirComprobanteArca("v1", fetchImpl)).toEqual({
      kind: "error",
      message: "No se pudo emitir el comprobante",
    })
  })

  it("falla de red -> mensaje de conexion", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"))
    expect(await emitirComprobanteArca("v1", fetchImpl)).toEqual({
      kind: "error",
      message: "Error de conexión al emitir el comprobante",
    })
  })
})
