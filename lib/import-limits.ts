/**
 * Techo de tamaño de /api/import (execute y preview) y del selector de archivo
 * que los alimenta.
 *
 * UN solo número, en un solo lugar, porque antes eran tres y no coincidían: el
 * cliente cortaba en 5 MB de archivo, el servidor en 8 MB de base64 (≈6 MB de
 * archivo) y el 413 decía "máx 6MB". Un CSV de 5,5 MB lo frenaba el navegador
 * citando un límite que el servidor no tenía, y un cliente que no fuera el
 * navegador se comía un tercer número.
 *
 * El límite real es el del ARCHIVO. Lo demás se deriva: estas rutas reciben el
 * archivo como base64 dentro del JSON, y base64 infla 4/3, así que el cuerpo
 * admisible es esa inflación más el sobre JSON (mime, filename, entityType).
 *
 * Sin `next/server` a propósito: components/import/import-modal.tsx importa de
 * acá, y meter NextResponse en el bundle del cliente rompe el build. Las rutas
 * arman su propia respuesta con MAX_IMPORT_FILE_LABEL.
 */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024

/** Cómo se le nombra el techo a una persona. Une el mensaje del navegador con
 *  el del 413: los dos hablan del archivo, que es lo que el usuario eligió. */
export const MAX_IMPORT_FILE_LABEL = "5MB"

/** El mismo techo medido sobre el cuerpo: base64 (4/3) más el sobre JSON. */
export const MAX_IMPORT_BODY_BYTES = Math.ceil((MAX_IMPORT_FILE_BYTES * 4) / 3) + 4096

/**
 * True cuando el request DECLARA un cuerpo por encima del techo.
 *
 * Se mira `content-length` y no el archivo ya parseado a propósito: lo que hay
 * que evitar es materializar el cuerpo en memoria, así que un guard posterior a
 * `request.json()` no evita nada — para cuando corre, el base64 entero ya está
 * en el heap. Es el agujero anotado en docs/audit-2026-06-09.md ("Import execute
 * accepts unbounded base64 file body"), y se volvió más ancho cuando el gate de
 * entidad obligó a leer el cuerpo antes del chequeo de plan: hasta entonces una
 * organización sin el feature se comía un 403 sin que nadie tocara el body.
 *
 * ALCANCE REAL, sin adornos: esto solo frena a quien declara el tamaño. Un
 * request SIN el header pasa entero —`Number(null)` es 0, no NaN—, y eso incluye
 * cualquier cliente que no lo mande, no solo los chunked. Para ese caso queda el
 * techo de request de la plataforma. Cerrarlo de verdad pide leer el stream de a
 * pedazos y cortar al pasarse; por eso el hallazgo del audit queda PARCIALMENTE
 * cerrado, no cerrado.
 */
export function excedeTechoDeImportacion(request: Request): boolean {
  const declarado = Number(request.headers.get("content-length"))
  return Number.isFinite(declarado) && declarado > MAX_IMPORT_BODY_BYTES
}
