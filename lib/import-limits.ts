import { NextResponse } from "next/server"

/**
 * Techo del cuerpo de /api/import (execute y preview).
 *
 * Mismo presupuesto que app/api/inventario/precios/parse/route.ts, que ya
 * recibe archivos por el mismo camino: 8 MB de base64 son unos 6 MB de archivo
 * real. De sobra para lo que importa un mostrador — un CSV de 6 MB son decenas
 * de miles de filas y el batch de inserción es de 500.
 */
export const MAX_IMPORT_BODY_BYTES = 8 * 1024 * 1024

/**
 * Rechaza un cuerpo declarado más grande que el techo, ANTES de leerlo.
 *
 * El chequeo va sobre `content-length` y no sobre el archivo ya parseado a
 * propósito: lo que hay que evitar es materializar el cuerpo en memoria, así que
 * un guard posterior a `request.json()` no evita nada — para cuando corre, el
 * base64 entero ya está en el heap. Es el agujero anotado en
 * docs/audit-2026-06-09.md ("Import execute accepts unbounded base64 file
 * body"), y se volvió más ancho cuando el gate de entidad obligó a leer el
 * cuerpo antes del chequeo de plan: hasta entonces una organización sin el
 * feature se comía un 403 sin que nadie tocara el body.
 *
 * Un request sin `content-length` (chunked) se escapa de acá; para ese queda el
 * techo de request de la plataforma. Cubrir eso pide leer el stream de a
 * pedazos, que es otra discusión.
 */
export function rejectOversizedImportBody(request: Request): NextResponse | null {
  const declarado = Number(request.headers.get("content-length"))
  if (Number.isFinite(declarado) && declarado > MAX_IMPORT_BODY_BYTES) {
    return NextResponse.json(
      { error: "Archivo demasiado grande (máx 6MB)" },
      { status: 413 },
    )
  }
  return null
}
