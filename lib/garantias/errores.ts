import { NextResponse } from "next/server"

/**
 * Un "no" esperado del flujo de reclamos (garantía vencida, reclamo duplicado,
 * rol sin permiso…). Las rutas lo convierten en la respuesta con `code` para
 * que la UI pueda reaccionar (por ejemplo, pedir el motivo para forzar).
 */
export class ErrorReclamo extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
    /** Respuesta ya armada (p. ej. la del límite del plan). */
    public readonly respuesta?: NextResponse
  ) {
    super(message)
    this.name = "ErrorReclamo"
  }

  toResponse(): NextResponse {
    return this.respuesta ?? NextResponse.json({ error: this.message, code: this.code, ...this.extra }, { status: this.status })
  }
}

export function esErrorReclamo(err: unknown): err is ErrorReclamo {
  return err instanceof ErrorReclamo
}

/**
 * La FK reclamos_garantia.garantia_venta_id (401, NO ACTION) frena borrar las
 * garantías de una venta con reclamos: editar_venta_atomica las borra y
 * recrea, y borrar la venta las borra en cascada. Las rutas de ventas
 * convierten ese error en un 409 con este criterio.
 */
export function esBloqueoPorReclamos(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "23503" && /reclamos_garantia/.test(error.message ?? "")
}

export const MENSAJE_VENTA_CON_RECLAMOS = "la venta tiene reclamos de garantía registrados."
