import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"
import { rejectIfPractica } from "@/lib/onboarding/practica"
import { AVANCE_MAX_CHARS, TIPO_AVANCE, esVisibleCliente } from "@/lib/ordenes/avances"

const avanceSchema = z.object({
  texto: z.string().trim().min(1, "Escribí el avance").max(AVANCE_MAX_CHARS, `Máximo ${AVANCE_MAX_CHARS} caracteres`),
  visibleCliente: z.boolean().default(true),
})

interface AvanceRow {
  id: string
  descripcion: string | null
  estado_nuevo: string | null
  metadata: unknown
  created_at: string
  created_by: string | null
  users?: { nombre?: string | null } | null
}

function avanceDTO(r: AvanceRow) {
  return {
    id: r.id,
    texto: r.descripcion ?? "",
    estado: r.estado_nuevo,
    visibleCliente: esVisibleCliente(r.metadata),
    createdAt: r.created_at,
    autorId: r.created_by,
    autor: r.users?.nombre ?? null,
  }
}

const SELECT = "id, descripcion, estado_nuevo, metadata, created_at, created_by, users:created_by (nombre)"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId } = autenticado
    if (error) return error

    const { id } = await params
    const cargada = await cargarOrdenEnAlcance(id, actorDeSesion(autenticado), "leer", { select: "id" })
    if ("error" in cargada) return cargada.error

    const { data, error: dbError } = await supabaseAdmin
      .from("orden_eventos")
      .select(SELECT)
      .eq("orden_id", id)
      .eq("organization_id", organizationId!)
      .eq("tipo", TIPO_AVANCE)
      .order("created_at", { ascending: true })

    if (dbError) throw dbError

    return NextResponse.json(((data ?? []) as AvanceRow[]).map(avanceDTO))
  } catch (error) {
    console.error("Error fetching avances:", error)
    return NextResponse.json({ error: "Error al obtener los avances" }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId, userId } = autenticado
    if (error) return error

    const { id } = await params
    const body = avanceSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: body.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 })
    }

    const cargada = await cargarOrdenEnAlcance(id, actorDeSesion(autenticado), "reparar", { select: "id, estado" })
    if ("error" in cargada) return cargada.error

    const practica = await rejectIfPractica(id, organizationId!)
    if (practica) return practica

    const { data, error: dbError } = await supabaseAdmin
      .from("orden_eventos")
      .insert({
        orden_id: id,
        organization_id: organizationId!,
        tipo: TIPO_AVANCE,
        estado_nuevo: cargada.orden.estado ?? null,
        descripcion: body.data.texto,
        metadata: { visible_cliente: body.data.visibleCliente },
        created_by: userId,
      })
      .select(SELECT)
      .single()

    if (dbError) throw dbError

    return NextResponse.json(avanceDTO(data as AvanceRow), { status: 201 })
  } catch (error) {
    console.error("Error creating avance:", error)
    return NextResponse.json({ error: "Error al guardar el avance" }, { status: 500 })
  }
}
