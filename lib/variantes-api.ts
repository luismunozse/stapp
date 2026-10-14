import "server-only"
import { NextResponse } from "next/server"
import type { z } from "zod"
import { isMissingColumnError } from "@/lib/db-errors"
import { mensajeDeIssue } from "@/lib/variantes-schema"

// SERVER-ONLY half of PUT /api/inventario/grupos/[id]: the map from the errors of the save
// RPC `guardar_grupo_variantes` to HTTP answers, the single deadlock retry, the 503 for a
// missing migration and the 400 for a rejected body. The pure schema and mapper live in
// lib/variantes-schema.ts (importable from client components); do not import THIS file from
// one. A deadlock (40P01) between two saves is retried once and then answered as a
// retryable 409.

// ---- RPC errors -> HTTP -----------------------------------------------------------------

export interface RespuestaError {
  status: number
  body: { error: string; code: string; [dato: string]: unknown }
}

const respuesta = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): RespuestaError => ({
  status,
  body: { error, code, ...extra },
})

const pendiente = () => respuesta(503, "MIGRACION_PENDIENTE", "Variantes todavía no está disponible")

/** While migration 355 or 361 is not applied the group routes answer this instead of a 500. */
export function migracionPendiente() {
  const { status, body } = pendiente()
  return NextResponse.json(body, { status })
}

// Codes that mean "an object of an unapplied migration is missing". isMissingColumnError
// already matches 42703 and PGRST204 by code but reads the rest only by their English text,
// so a bare code or a translated message would slip through without this list.
const CODIGOS_MIGRACION = new Set(["42883", "42P01", "PGRST200", "PGRST202", "PGRST205"])
const CODIGOS_REINTENTABLES = new Set(["40P01", "40001"])

const campo = (error: unknown, nombre: "code" | "message") =>
  typeof error === "object" && error !== null ? String((error as Record<string, unknown>)[nombre] ?? "") : ""

/** The id after `TOKEN: ` when the message names exactly one item (it can also say "an archived id belongs to another group"). */
function itemDe(message: string, token: string): { item?: string } {
  const m = message.match(new RegExp("^" + token + ":\\s*(\\S+)$"))
  return m ? { item: m[1] } : {}
}

/** Deadlock and serialization failure: another save held the rows, the same call may pass now. */
export function esReintentable(error: unknown): boolean {
  return CODIGOS_REINTENTABLES.has(campo(error, "code"))
}

/**
 * Runs the RPC; on a deadlock it runs it once more (the failed transaction rolled back, so
 * the same arguments are safe: new rows are upserts by client id). A second failure is
 * returned as it is.
 */
export async function conReintento<R extends { error?: unknown }>(llamar: () => PromiseLike<R>): Promise<R> {
  const primero = await llamar()
  return esReintentable(primero.error) ? await llamar() : primero
}

/**
 * The answer for an error of the save RPC, or null when it is not one of ours (the route
 * then answers 500). Known SQLSTATEs come FIRST: a P0002 whose text says "does not exist"
 * is a 404, and only what is left is checked for a missing migration.
 */
export function mapearErrorRpc(error: unknown): RespuestaError | null {
  if (!error || typeof error !== "object") return null
  const code = campo(error, "code")
  const message = campo(error, "message")

  switch (code) {
    case "22023": {
      const faltantes = message.match(/^PAYLOAD_INVALIDO:miembros_faltantes:(.+)$/)
      if (faltantes) {
        return respuesta(409, "MIEMBROS_FALTANTES", "El producto cambió mientras lo editabas. Recargá la pantalla y volvé a intentar", {
          faltantes: faltantes[1].split(",").map((id) => id.trim()).filter(Boolean),
          recargar: true,
        })
      }
      return respuesta(400, "PAYLOAD_INVALIDO", "Los datos de las variantes no son válidos")
    }
    case "P0002":
      return respuesta(404, "NO_ENCONTRADO", "No encontramos el producto o el grupo de variantes")
    case "P0030":
      return respuesta(409, "COMBINACION_DUPLICADA", "Hay dos variantes con la misma combinación")
    case "P0031":
      return respuesta(409, "ITEM_EN_OTRO_GRUPO", "Un producto ya pertenece a otro grupo de variantes", itemDe(message, "ITEM_EN_OTRO_GRUPO"))
    case "P0032":
      return respuesta(422, "KIT_NO_PERMITIDO", "Un kit no puede ser una variante", itemDe(message, "KIT_NO_PERMITIDO"))
    case "P0033": {
      const reservado = message.match(/^STOCK_RESERVADO:([^:]+):(\d+)$/)
      return reservado
        ? respuesta(409, "STOCK_RESERVADO", `No se puede archivar la variante: tiene ${reservado[2]} unidades reservadas`, {
            variante: reservado[1],
            unidades: Number(reservado[2]),
          })
        : respuesta(409, "STOCK_RESERVADO", "No se puede archivar una variante con stock reservado")
    }
    case "P0034":
      return respuesta(422, "LIMITE_EXCEDIDO", "Superaste el máximo de opciones o variantes")
    case "P0035": {
      const duplicados = message.match(/^CODIGO_DUPLICADO:(.+)$/)
      if (!duplicados) return respuesta(409, "CODIGO_DUPLICADO", "Ya existe otro producto con ese código")
      const codigos = duplicados[1].split(",")
      return respuesta(409, "CODIGO_DUPLICADO", `Ya existe otro producto con el código ${codigos.join(", ")}`, { codigos })
    }
    case "23505":
      return respuesta(409, "CONFLICTO", "Dos variantes chocan en código o combinación. Revisá los datos y probá de nuevo")
    case "23514":
      return respuesta(400, "DATOS_INVALIDOS", "Los datos no cumplen las reglas del inventario")
    case "23503":
      return respuesta(404, "NO_ENCONTRADO", "Alguno de los productos o el proveedor ya no existe")
    case "40P01":
    case "40001":
      return respuesta(409, "REINTENTAR", "Otra persona estaba guardando al mismo tiempo. Probá de nuevo", { reintentable: true })
    case "P0010":
      return respuesta(400, "STOCK_INVALIDO", "No hay stock suficiente en el depósito elegido")
    case "P0011":
      return respuesta(400, "DEPOSITO_INVALIDO", "La organización no tiene depósito principal configurado")
  }

  return CODIGOS_MIGRACION.has(code) || isMissingColumnError(error) ? pendiente() : null
}

/** `mapearErrorRpc` as a Response, or null when the error is not one the RPC raises. */
export function respuestaDeError(error: unknown): NextResponse | null {
  const mapeado = mapearErrorRpc(error)
  return mapeado ? NextResponse.json(mapeado.body, { status: mapeado.status }) : null
}

/**
 * The 400 for a body the schema rejects: the FIRST issue's Spanish message, a machine code
 * and the field (`variantes.1.imagenUrl`; for an unknown key, the path plus the key itself).
 */
export function respuestaDeValidacion(error: z.ZodError): NextResponse {
  const [primero] = error.issues
  const ruta = primero?.path ?? []
  const campo =
    primero?.code === "unrecognized_keys"
      ? primero.keys.map((clave) => [...ruta, clave].join(".")).join(",")
      : ruta.join(".")
  return NextResponse.json(
    { error: primero ? mensajeDeIssue(primero) : "Los datos de las variantes no son válidos", code: "PAYLOAD_INVALIDO", campo },
    { status: 400 }
  )
}
