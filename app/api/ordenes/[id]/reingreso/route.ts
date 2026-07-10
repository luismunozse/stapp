import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { requireAuth, requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextOrderNumberByType } from "@/lib/counters"
import { createAuditLogger } from "@/lib/audit"
import { getPrincipalId } from "@/lib/sucursal"
import { z } from "zod"

const reingresoSchema = z.object({
  problemaReportado: z.string().min(1, "Debe describir el problema"),
  garantiaId: z.string().optional(),
  observaciones: z.string().optional(),
})

/**
 * POST /api/ordenes/[id]/reingreso
 * Crea una nueva orden vinculada a la orden original (re-ingreso por garantía).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdminOrVendedor()
    if (error) return error

    const { id: ordenOrigenId } = await params
    const body = await request.json()
    const data = reingresoSchema.parse(body)

    // Obtener orden original
    const { data: ordenOrigen, error: fetchError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        *,
        clientes (*)
      `)
      .eq("id", ordenOrigenId)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !ordenOrigen) {
      return NextResponse.json({ error: "Orden original no encontrada" }, { status: 404 })
    }

    // Solo se puede re-ingresar desde ENTREGADO o REPARADO
    if (!["ENTREGADO", "REPARADO"].includes(ordenOrigen.estado)) {
      return NextResponse.json(
        { error: "Solo se puede crear re-ingreso desde órdenes entregadas o reparadas" },
        { status: 400 }
      )
    }

    // Resolver sucursal_id: inherit from origin, fallback to principal
    let reingresoSucursalId: string | null = ordenOrigen.sucursal_id ?? null
    if (!reingresoSucursalId) {
      reingresoSucursalId = await getPrincipalId(organizationId!)
    }
    if (!reingresoSucursalId) {
      return NextResponse.json(
        { error: "No se pudo determinar la sucursal del re-ingreso" },
        { status: 500 }
      )
    }

    // Generar número de orden
    const { codigo: codigoOrden, numero: numeroOrden } = await getNextOrderNumberByType(
      organizationId!,
      ordenOrigen.tipo_dispositivo
    )

    const publicToken = randomBytes(16).toString("hex")

    // Crear nueva orden vinculada
    const { data: nuevaOrden, error: insertError } = await supabaseAdmin
      .from("ordenes_servicio")
      .insert({
        numero_orden: numeroOrden,
        codigo_orden: codigoOrden,
        cliente_id: ordenOrigen.cliente_id,
        organization_id: organizationId!,
        dispositivo: ordenOrigen.dispositivo,
        tipo_dispositivo: ordenOrigen.tipo_dispositivo,
        marca: ordenOrigen.marca,
        color: ordenOrigen.color,
        imei: ordenOrigen.imei,
        problema_reportado: data.problemaReportado,
        accesorios: ordenOrigen.accesorios,
        password_dispositivo: ordenOrigen.password_dispositivo,
        public_token: publicToken,
        estado: "RECIBIDO",
        observaciones: data.observaciones || `Re-ingreso por garantía de orden ${ordenOrigen.codigo_orden || `#${ordenOrigen.numero_orden}`}`,
        metadata: ordenOrigen.metadata || {},
        sector_id: ordenOrigen.sector_id,
        sucursal_id: reingresoSucursalId,
        // Campos de re-ingreso
        orden_origen_id: ordenOrigenId,
        es_reingreso: true,
        garantia_origen_id: data.garantiaId || null,
      })
      .select(`*, clientes (*)`)
      .single()

    if (insertError) throw insertError

    // Registrar evento en la orden original
    await supabaseAdmin.from("orden_eventos").insert({
      orden_id: ordenOrigenId,
      organization_id: organizationId!,
      tipo: "NOTA",
      descripcion: `Re-ingreso creado: orden ${codigoOrden || `#${numeroOrden}`}`,
      metadata: { reingresoOrdenId: nuevaOrden.id },
      created_by: userId,
    })

    // Evento de creación en la nueva orden (fire-and-forget: un fallo acá
    // no debe hacer fallar la creación del re-ingreso)
    void (async () => {
      try {
        await supabaseAdmin.from("orden_eventos").insert({
          orden_id: nuevaOrden.id,
          organization_id: organizationId!,
          tipo: "CAMBIO_ESTADO",
          estado_nuevo: "RECIBIDO",
          descripcion: `Orden creada como re-ingreso de la orden ${ordenOrigen.codigo_orden || `#${ordenOrigen.numero_orden}`}`,
          metadata: { ordenOrigenId },
          created_by: userId,
        })
      } catch (err) {
        console.error("Error inserting orden_evento (creación reingreso):", err)
      }
    })()

    // Auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("ordenes_servicio", nuevaOrden.id, {
      tipo: "reingreso",
      orden_origen_id: ordenOrigenId,
      numero_orden: numeroOrden,
    })

    return NextResponse.json({
      id: nuevaOrden.id,
      numeroOrden: nuevaOrden.numero_orden,
      codigoOrden: nuevaOrden.codigo_orden,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error creating reingreso:", error)
    return NextResponse.json({ error: "Error al crear re-ingreso" }, { status: 500 })
  }
}
