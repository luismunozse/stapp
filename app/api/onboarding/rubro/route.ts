import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { DEFAULT_RUBRO_ID } from "@/lib/rubros"
import { validarSeleccionRubro, mismoRubro, type SeleccionRubro } from "@/lib/rubros/seleccion"
import { aplicarCambioDeRubro, estadoCoincideConRubro } from "@/lib/rubros/cambio"
import { countRealOrders, deletePracticeData } from "@/lib/onboarding/practica"

/** Same limit as the signup (app/api/auth/register/route.ts:32). */
const MAX_DETALLE = 120

const bodySchema = z.object(
  {
    rubro: z.string({
      required_error: "Elegí qué reparás",
      invalid_type_error: "Elegí qué reparás",
    }),
    rubroDetalle: z
      .string({ invalid_type_error: "Datos inválidos" })
      .max(MAX_DETALLE, `Contanos qué reparás en menos de ${MAX_DETALLE} caracteres`)
      .nullable()
      .optional(),
  },
  { required_error: "Datos inválidos", invalid_type_error: "Datos inválidos" }
)

const ERROR_INTERNO = "No pudimos cambiar el rubro. Probá de nuevo."
const ERROR_CON_ORDENES = "Ya tenés órdenes cargadas: el rubro no se puede cambiar desde acá."

/**
 * Changes the rubro from the onboarding wizard while the shop has no real
 * orders. The spec's order: delete the practice, then aplicarCambioDeRubro
 * (tipos, checklists, vocabulary, rubro). See lib/rubros/cambio.ts.
 */
export async function PUT(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const orgId = organizationId!

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? "Datos inválidos" },
        { status: 400 }
      )
    }

    const rubro = parsed.data.rubro.trim()
    const detalle = parsed.data.rubroDetalle?.trim() ?? ""

    // The signup form's own rule (app/(auth)/registro/page.tsx:173): a known
    // id, and genérico needs a trade we can derive a tipo from.
    const errorSeleccion = validarSeleccionRubro(rubro, detalle)
    if (errorSeleccion) {
      return NextResponse.json({ error: errorSeleccion }, { status: 400 })
    }

    // Migration 308: rubro_detalle is NULL for a curated pack.
    const pedido: SeleccionRubro = {
      rubro,
      rubroDetalle: rubro === DEFAULT_RUBRO_ID ? detalle : null,
    }

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("rubro, rubro_detalle")
      .eq("id", orgId)
      .single()
    if (orgError || !org) {
      throw new Error(`organizations: ${orgError?.message ?? "not found"}`)
    }

    // Fail closed: countRealOrders throws on a DB error, so an unknown count
    // never reads as "no real orders" (the catch below answers 500).
    if ((await countRealOrders(orgId)) > 0) {
      return NextResponse.json({ error: ERROR_CON_ORDENES }, { status: 409 })
    }

    const anterior: SeleccionRubro = {
      rubro: org.rubro ?? null,
      rubroDetalle: org.rubro_detalle ?? null,
    }

    // Re-picking the current rubro writes nothing: it keeps the practice and
    // any vocabulary the shop edited by hand. Only when the stored tipos match
    // the rubro: otherwise (half-applied change, failed signup seed) the full
    // change below runs and repairs them.
    if (mismoRubro(anterior, pedido)) {
      const estado = await estadoCoincideConRubro(orgId, pedido)
      if (estado.consistente) {
        return NextResponse.json({ ...pedido, tiposActivos: estado.tiposActivos })
      }
    }

    await deletePracticeData(orgId)
    const { tiposActivos } = await aplicarCambioDeRubro(orgId, anterior, pedido)

    return NextResponse.json({ ...pedido, tiposActivos })
  } catch (err) {
    console.error("Error changing rubro:", err)
    return NextResponse.json({ error: ERROR_INTERNO }, { status: 500 })
  }
}
