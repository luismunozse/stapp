import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { z } from "zod"

const updateFacturaSchema = z.object({
  estadoPago: z.enum(["PENDIENTE", "PAGADO_PARCIAL", "PAGADO", "ANULADA"]).optional(),
})

// Returns true when the RPC error indicates the function does not exist yet.
function isFunctionMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as Record<string, unknown>
  const code = String(e.code ?? "")
  const msg = String(e.message ?? "").toLowerCase()
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  )
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, session, role } = await requireAdmin()
    if (error) return error

    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const sid = filtro.verTodas ? null : filtro.sucursalId

    const { id } = await params

    let query = supabaseAdmin
      .from("facturas")
      .select(`
        *,
        ordenes_servicio!inner (
          id,
          numero_orden,
          dispositivo,
          organization_id,
          clientes (*)
        ),
        pagos_parciales (*)
      `)
      .eq("id", id)
      .eq("ordenes_servicio.organization_id", organizationId!)

    if (sid) query = query.eq("ordenes_servicio.sucursal_id", sid)

    const { data: factura, error: dbError } = await query.single()

    if (dbError || !factura) {
      return NextResponse.json(
        { error: "Factura no encontrada" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: factura.id,
      ordenId: factura.orden_id,
      numeroFactura: factura.numero_factura,
      fecha: factura.fecha,
      subtotal: factura.subtotal,
      iva: factura.iva,
      total: factura.total,
      montoAbonado: factura.monto_abonado,
      estadoPago: factura.estado_pago,
      createdAt: factura.fecha,
      orden: {
        id: factura.ordenes_servicio.id,
        numeroOrden: factura.ordenes_servicio.numero_orden,
        dispositivo: factura.ordenes_servicio.dispositivo,
        cliente: factura.ordenes_servicio.clientes,
      },
      pagos: factura.pagos_parciales?.map((p: any) => ({
        id: p.id,
        monto: p.monto,
        metodoPago: p.metodo_pago,
        referencia: p.numero_referencia,
        fecha: p.fecha,
        notas: p.observaciones,
        cuotas: p.cuotas,
        recargoPorcentaje: p.recargo_porcentaje,
        montoOriginal: p.monto_original,
      })).sort((a: any, b: any) =>
        new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
      ),
    }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("Error fetching factura:", error)
    return NextResponse.json(
      { error: "Error al obtener factura" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAdmin()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden modificar facturas" },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const data = updateFacturaSchema.parse(body)

    // Only ANULADA is an actionable estado change.
    // All other values (PAGADO, PENDIENTE, PAGADO_PARCIAL) are derived from
    // payments and must not be set manually.
    if (data.estadoPago !== undefined && data.estadoPago !== "ANULADA") {
      return NextResponse.json(
        { error: "El estado de pago se deriva de los pagos; la factura solo puede anularse." },
        { status: 400 }
      )
    }

    if (data.estadoPago === "ANULADA") {
      return await handleAnularFactura({ id, organizationId: organizationId!, userId: userId! })
    }

    // No actionable fields — nothing to update
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating factura:", error)
    return NextResponse.json(
      { error: "Error al actualizar factura" },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// handleAnularFactura — tries RPC first, JS fallback if function missing
// ---------------------------------------------------------------------------
async function handleAnularFactura(opts: {
  id: string
  organizationId: string
  userId: string
}): Promise<NextResponse> {
  const { id, organizationId, userId } = opts

  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
    "anular_factura_atomica",
    {
      p_org_id: organizationId,
      p_factura_id: id,
      p_user_id: userId,
    }
  )

  if (!rpcError) {
    // Fetch and return the updated factura (same shape as before)
    return await fetchAndReturnFactura(id)
  }

  if (isFunctionMissingError(rpcError)) {
    console.warn("[facturacion] anular_factura_atomica not found; falling back to JS path")
    return await anularFacturaJsFallback({ id, organizationId, userId })
  }

  // Map known business errors
  const msg = rpcError.message ?? ""
  if (msg.includes("no encontrada")) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
  }
  if (msg.includes("No autorizado")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  if (msg.includes("ya esta anulada")) {
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  console.error("[facturacion] Unexpected RPC error (anular):", rpcError)
  return NextResponse.json({ error: "Error al anular factura" }, { status: 500 })
}

// ---------------------------------------------------------------------------
// JS fallback for anular — used when migration 248 is not yet applied
// ---------------------------------------------------------------------------
async function anularFacturaJsFallback(opts: {
  id: string
  organizationId: string
  userId: string
}): Promise<NextResponse> {
  const { id, organizationId, userId } = opts

  // Load factura with orden (org check) and pagos_parciales (CC re-credit)
  const { data: factura, error: fetchError } = await supabaseAdmin
    .from("facturas")
    .select(`
      id, numero_factura, estado_pago,
      ordenes_servicio!inner(organization_id, cliente_id),
      pagos_parciales(monto, metodo_pago)
    `)
    .eq("id", id)
    .single()

  if (fetchError || !factura) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
  }

  const ordenOrgId = (factura.ordenes_servicio as any)?.organization_id
  if (ordenOrgId !== organizationId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  if ((factura as any).estado_pago === "ANULADA") {
    return NextResponse.json({ error: "La factura ya esta anulada" }, { status: 400 })
  }

  const clienteId = (factura.ordenes_servicio as any)?.cliente_id
  const pagos: Array<{ monto: number; metodo_pago: string }> =
    (factura as any).pagos_parciales ?? []

  // Re-credit CC pagos
  for (const pago of pagos) {
    if (pago.metodo_pago === "CUENTA_CORRIENTE" && clienteId) {
      const { error: ccError } = await supabaseAdmin.rpc("devolver_cuenta_corriente", {
        p_org_id: organizationId,
        p_cliente_id: clienteId,
        p_monto: pago.monto,
        p_referencia_tipo: "FACTURA",
        p_referencia_id: id,
        p_usuario_id: userId,
        p_observaciones: `Anulacion factura ${(factura as any).numero_factura}`,
      })
      if (ccError) {
        console.error("[facturacion] Error re-crediting CC on anular:", ccError)
        return NextResponse.json(
          { error: ccError.message || "Error al devolver cuenta corriente" },
          { status: 500 }
        )
      }
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from("facturas")
    .update({ estado_pago: "ANULADA" })
    .eq("id", id)

  if (updateError) {
    console.error("[facturacion] Error updating estado_pago to ANULADA:", updateError)
    return NextResponse.json({ error: "Error al anular factura" }, { status: 500 })
  }

  return await fetchAndReturnFactura(id)
}

// ---------------------------------------------------------------------------
// fetchAndReturnFactura — re-reads the factura and returns the standard shape
// ---------------------------------------------------------------------------
async function fetchAndReturnFactura(id: string): Promise<NextResponse> {
  const { data: factura, error: fetchError } = await supabaseAdmin
    .from("facturas")
    .select(`
      *,
      ordenes_servicio (
        id,
        numero_orden,
        dispositivo,
        clientes (*)
      ),
      pagos_parciales (*)
    `)
    .eq("id", id)
    .single()

  if (fetchError || !factura) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
  }

  return NextResponse.json({
    id: factura.id,
    ordenId: factura.orden_id,
    numeroFactura: factura.numero_factura,
    fecha: factura.fecha,
    subtotal: factura.subtotal,
    iva: factura.iva,
    total: factura.total,
    montoAbonado: factura.monto_abonado,
    estadoPago: factura.estado_pago,
    orden: {
      id: factura.ordenes_servicio.id,
      numeroOrden: factura.ordenes_servicio.numero_orden,
      dispositivo: factura.ordenes_servicio.dispositivo,
      cliente: factura.ordenes_servicio.clientes,
    },
    pagos: factura.pagos_parciales?.map((p: any) => ({
      id: p.id,
      monto: p.monto,
      metodoPago: p.metodo_pago,
      referencia: p.numero_referencia,
      fecha: p.fecha,
      notas: p.observaciones,
      cuotas: p.cuotas,
      recargoPorcentaje: p.recargo_porcentaje,
      montoOriginal: p.monto_original,
    })),
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role, userId } = await requireAdmin()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden eliminar facturas" },
        { status: 403 }
      )
    }

    const { id } = await params

    // Pre-check: verify the factura exists and belongs to this org
    // (needed for audit log details and early 404/403 before RPC)
    const { data: factura, error: fetchError } = await supabaseAdmin
      .from("facturas")
      .select(`
        id,
        numero_factura,
        total,
        ordenes_servicio!inner(
          organization_id,
          numero_orden
        )
      `)
      .eq("id", id)
      .single()

    if (fetchError || !factura) {
      return NextResponse.json(
        { error: "Factura no encontrada" },
        { status: 404 }
      )
    }

    const ordenOrgId = (factura.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    // --- Atomic RPC path (migration 248) ---
    const { error: rpcError } = await supabaseAdmin.rpc("eliminar_factura_atomica", {
      p_org_id: organizationId!,
      p_factura_id: id,
      p_user_id: userId!,
    })

    if (!rpcError) {
      // Audit log after successful atomic delete
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: organizationId,
        user_id: userId,
        action: "DELETE_FACTURA",
        entity_type: "factura",
        entity_id: id,
        details: {
          numero_factura: factura.numero_factura,
          total: factura.total,
          numero_orden: (factura.ordenes_servicio as any)?.numero_orden,
        },
      })
      return NextResponse.json({ success: true })
    }

    if (isFunctionMissingError(rpcError)) {
      console.warn("[facturacion] eliminar_factura_atomica not found; falling back to JS path")
      return await eliminarFacturaJsFallback({ id, organizationId: organizationId!, userId: userId!, factura })
    }

    // Map known business errors
    const msg = rpcError.message ?? ""
    if (msg.includes("no encontrada")) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
    }
    if (msg.includes("No autorizado")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    console.error("[facturacion] Unexpected RPC error (eliminar):", rpcError)
    return NextResponse.json({ error: "Error al eliminar factura" }, { status: 500 })

  } catch (error) {
    console.error("Error deleting factura:", error)
    return NextResponse.json(
      { error: "Error al eliminar factura" },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// JS fallback for delete — used when migration 248 is not yet applied
// ---------------------------------------------------------------------------
async function eliminarFacturaJsFallback(opts: {
  id: string
  organizationId: string
  userId: string
  factura: any
}): Promise<NextResponse> {
  const { id, organizationId, userId, factura } = opts

  // Load pagos_parciales to re-credit CC
  const { data: pagos, error: pagosError } = await supabaseAdmin
    .from("pagos_parciales")
    .select("monto, metodo_pago")
    .eq("factura_id", id)

  if (pagosError) {
    console.error("[facturacion] Error loading pagos for CC re-credit:", pagosError)
    return NextResponse.json({ error: "Error al eliminar factura" }, { status: 500 })
  }

  // Load cliente_id from orden
  const { data: fullFactura } = await supabaseAdmin
    .from("facturas")
    .select("ordenes_servicio!inner(cliente_id)")
    .eq("id", id)
    .single()

  const clienteId = (fullFactura?.ordenes_servicio as any)?.cliente_id

  // Re-credit CC before deleting — abort on error
  for (const pago of (pagos ?? [])) {
    if ((pago as any).metodo_pago === "CUENTA_CORRIENTE" && clienteId) {
      const { error: ccError } = await supabaseAdmin.rpc("devolver_cuenta_corriente", {
        p_org_id: organizationId,
        p_cliente_id: clienteId,
        p_monto: (pago as any).monto,
        p_referencia_tipo: "FACTURA",
        p_referencia_id: id,
        p_usuario_id: userId,
        p_observaciones: `Eliminacion factura ${factura.numero_factura}`,
      })
      if (ccError) {
        console.error("[facturacion] Error re-crediting CC on delete:", ccError)
        return NextResponse.json(
          { error: ccError.message || "Error al devolver cuenta corriente" },
          { status: 500 }
        )
      }
    }
  }

  // Delete pagos_parciales first, then the factura
  const { error: deletePagosError } = await supabaseAdmin
    .from("pagos_parciales")
    .delete()
    .eq("factura_id", id)

  if (deletePagosError) {
    console.error("[facturacion] Error deleting pagos:", deletePagosError)
    return NextResponse.json({ error: "Error al eliminar factura" }, { status: 500 })
  }

  const { error: deleteError } = await supabaseAdmin
    .from("facturas")
    .delete()
    .eq("id", id)

  if (deleteError) {
    console.error("[facturacion] Error deleting factura:", deleteError)
    return NextResponse.json({ error: "Error al eliminar factura" }, { status: 500 })
  }

  // Audit log
  await supabaseAdmin.from("audit_logs").insert({
    organization_id: organizationId,
    user_id: userId,
    action: "DELETE_FACTURA",
    entity_type: "factura",
    entity_id: id,
    details: {
      numero_factura: factura.numero_factura,
      total: factura.total,
      numero_orden: (factura.ordenes_servicio as any)?.numero_orden,
    },
  })

  return NextResponse.json({ success: true })
}
