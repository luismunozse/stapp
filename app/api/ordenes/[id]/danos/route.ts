import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"
import { danoInputSchema, ESTADOS_SIN_NUEVOS_DANOS, mensajeErrorDanos, type DanoOrden } from "@/lib/ordenes/danos"
import { listarDanosOrden, vistaExisteEnDiagrama } from "@/lib/ordenes/danos-server"

// GET - Daños marcados en la orden
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId } = autenticado
    if (error) return error

    const { id: ordenId } = await params
    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "ver", { select: "id, estado" })
    if ("error" in cargada) return cargada.error

    const resultado = await listarDanosOrden(ordenId, organizationId!, { incluirAutor: true })
    const puedeAgregar =
      cargada.permisos.reparar && !(ESTADOS_SIN_NUEVOS_DANOS as readonly string[]).includes(cargada.orden.estado)
    return NextResponse.json({ ...resultado, puedeAgregar })
  } catch (error) {
    console.error("Error fetching order damages:", error)
    return NextResponse.json({ error: "Error al obtener los daños" }, { status: 500 })
  }
}

// POST - Agregar un daño detectado en el diagnóstico
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId, userId } = autenticado
    if (error) return error

    const { id: ordenId } = await params
    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "reparar", { select: "id" })
    if ("error" in cargada) return cargada.error

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 })
    }
    const parsed = danoInputSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const dano = parsed.data

    const { diagrama } = await listarDanosOrden(ordenId, organizationId!, { incluirAutor: false })
    if (dano.diagrama !== diagrama) {
      return NextResponse.json({ error: "El diagrama no corresponde a la orden" }, { status: 400 })
    }
    if (!vistaExisteEnDiagrama(diagrama, dano.vista)) {
      return NextResponse.json({ error: `La vista "${dano.vista}" no existe en el diagrama del equipo` }, { status: 400 })
    }

    const { data: fila, error: insertError } = await supabaseAdmin
      .from("orden_danos")
      .insert({
        organization_id: organizationId!,
        orden_id: ordenId,
        diagrama: dano.diagrama,
        vista: dano.vista,
        x: dano.x,
        y: dano.y,
        tipo: dano.tipo,
        nota: dano.nota?.trim() || null,
        momento: "diagnostico",
        created_by: userId,
      })
      .select("id, numero, diagrama, vista, x, y, tipo, nota, momento, created_at")
      .single()

    if (insertError || !fila) {
      const { status, error: mensaje } = mensajeErrorDanos(insertError)
      if (status === 500) console.error("Error creating order damage:", insertError)
      return NextResponse.json({ error: mensaje }, { status })
    }

    const respuesta: DanoOrden = {
      id: fila.id,
      numero: fila.numero,
      diagrama: fila.diagrama,
      vista: fila.vista,
      x: Number(fila.x),
      y: Number(fila.y),
      tipo: fila.tipo,
      nota: fila.nota ?? null,
      momento: fila.momento,
      createdAt: fila.created_at,
      createdByNombre: null,
    }
    return NextResponse.json(respuesta, { status: 201 })
  } catch (error) {
    console.error("Error creating order damage:", error)
    return NextResponse.json({ error: "No se pudo guardar el daño" }, { status: 500 })
  }
}
