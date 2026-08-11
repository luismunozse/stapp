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

// ---------------------------------------------------------------------------
// fetchFacturaConOrigen — resolves a factura by id regardless of whether it
// is orden-sourced or venta-sourced. Two-step (base lookup by id, then a
// branch-specific `!inner` fetch) instead of a single dual-left-join query,
// for the same reason as GET /api/facturacion (see Task 3): embedded filters
// don't turn a left-embed into an inner join on the parent row.
//
// `organizationId` is mandatory and is enforced INSIDE both branch queries
// (`.eq("ordenes_servicio.organization_id", ...)` / `.eq("ventas.organization_id", ...)`),
// mirroring app/api/facturacion/route.ts. supabaseAdmin is service-role and
// bypasses RLS, so this is the only backstop against a cross-org row — a
// caller-side comparison after the fact is not enough, since it's easy for a
// future caller to forget it.
// ---------------------------------------------------------------------------
async function fetchFacturaConOrigen(
  id: string,
  organizationId: string,
  opts?: { sid?: string | null }
): Promise<{ origen: "orden" | "venta"; organizationId: string; factura: any } | null> {
  const { data: base, error: baseError } = await supabaseAdmin
    .from("facturas")
    .select("id, orden_id, venta_id")
    .eq("id", id)
    .single()

  if (baseError || !base) return null

  if (base.orden_id) {
    let query = supabaseAdmin
      .from("facturas")
      .select(`
        *,
        ordenes_servicio!inner (
          id,
          numero_orden,
          dispositivo,
          organization_id,
          sucursal_id,
          cliente_id,
          clientes (*)
        ),
        pagos_parciales (*)
      `)
      .eq("id", id)
      .eq("ordenes_servicio.organization_id", organizationId)
    if (opts?.sid) query = query.eq("ordenes_servicio.sucursal_id", opts.sid)
    const { data, error } = await query.single()
    if (error || !data) return null
    return { origen: "orden", organizationId: data.ordenes_servicio.organization_id, factura: data }
  }

  let query = supabaseAdmin
    .from("facturas")
    .select(`
      *,
      ventas!inner (
        id,
        numero_venta,
        cliente_nombre,
        cliente_id,
        organization_id,
        sucursal_id
      ),
      pagos_parciales (*)
    `)
    .eq("id", id)
    .eq("ventas.organization_id", organizationId)
  if (opts?.sid) query = query.eq("ventas.sucursal_id", opts.sid)
  const { data, error } = await query.single()
  if (error || !data) return null
  return { origen: "venta", organizationId: data.ventas.organization_id, factura: data }
}

function formatFacturaResponse(result: { origen: "orden" | "venta"; factura: any }) {
  const f = result.factura
  const base = {
    id: f.id,
    origen: result.origen,
    numeroFactura: f.numero_factura,
    fecha: f.fecha,
    subtotal: f.subtotal,
    iva: f.iva,
    total: f.total,
    montoAbonado: f.monto_abonado,
    estadoPago: f.estado_pago,
    createdAt: f.fecha,
    pagos: (f.pagos_parciales || [])
      .map((p: any) => ({
        id: p.id,
        monto: p.monto,
        metodoPago: p.metodo_pago,
        referencia: p.numero_referencia,
        fecha: p.fecha,
        notas: p.observaciones,
        cuotas: p.cuotas,
        recargoPorcentaje: p.recargo_porcentaje,
        montoOriginal: p.monto_original,
      }))
      .sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()),
  }

  if (result.origen === "orden") {
    return {
      ...base,
      ordenId: f.orden_id,
      orden: {
        id: f.ordenes_servicio.id,
        numeroOrden: f.ordenes_servicio.numero_orden,
        dispositivo: f.ordenes_servicio.dispositivo,
        cliente: f.ordenes_servicio.clientes,
      },
    }
  }

  return {
    ...base,
    ventaId: f.venta_id,
    venta: {
      id: f.ventas.id,
      numeroVenta: f.ventas.numero_venta,
      cliente: { id: f.ventas.cliente_id, nombre: f.ventas.cliente_nombre },
    },
  }
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
    const result = await fetchFacturaConOrigen(id, organizationId!, { sid })

    if (!result || result.organizationId !== organizationId) {
      return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
    }

    return NextResponse.json(formatFacturaResponse(result), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("Error fetching factura:", error)
    return NextResponse.json(
      { error: "Error al obtener remito" },
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
        { error: "Solo administradores pueden modificar remitos" },
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
        { error: "El estado de pago se deriva de los pagos; el remito solo puede anularse." },
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
      { error: "Error al actualizar remito" },
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
    return await fetchAndReturnFactura(id, organizationId)
  }

  if (isFunctionMissingError(rpcError)) {
    console.warn("[facturacion] anular_factura_atomica not found; falling back to JS path")
    return await anularFacturaJsFallback({ id, organizationId, userId })
  }

  // Map known business errors.
  // Migration 295 changed anular_factura_atomica's RAISE EXCEPTION wording to
  // "remito" (masculine): "Remito no encontrado" / "El remito ya esta anulado".
  // The old feminine substrings ("no encontrada" / "ya esta anulada") no
  // longer match that RPC's messages, so these checks use the new wording.
  // eliminar_factura_atomica is untouched by migration 295 and still raises
  // "Factura no encontrada" — its own match (below, in DELETE) keeps the old wording.
  const msg = rpcError.message ?? ""
  if (msg.includes("no encontrado")) {
    return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
  }
  if (msg.includes("No autorizado")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }
  if (msg.includes("ya esta anulado")) {
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  console.error("[facturacion] Unexpected RPC error (anular):", rpcError)
  return NextResponse.json({ error: "Error al anular remito" }, { status: 500 })
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
      ordenes_servicio!inner(organization_id, cliente_id, sucursal_id),
      pagos_parciales(monto, metodo_pago)
    `)
    .eq("id", id)
    .single()

  if (fetchError || !factura) {
    return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
  }

  const ordenOrgId = (factura.ordenes_servicio as any)?.organization_id
  if (ordenOrgId !== organizationId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  if ((factura as any).estado_pago === "ANULADA") {
    return NextResponse.json({ error: "El remito ya está anulado" }, { status: 400 })
  }

  const clienteId = (factura.ordenes_servicio as any)?.cliente_id
  const sucursalId = (factura.ordenes_servicio as any)?.sucursal_id ?? null
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
        p_observaciones: `Anulacion remito ${(factura as any).numero_factura}`,
        // Derived from the parent orden's sucursal_id, not the current
        // operator's active cookie.
        p_sucursal_id: sucursalId,
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
    return NextResponse.json({ error: "Error al anular remito" }, { status: 500 })
  }

  return await fetchAndReturnFactura(id, organizationId)
}

// ---------------------------------------------------------------------------
// fetchAndReturnFactura — re-reads the factura and returns the standard shape
// ---------------------------------------------------------------------------
async function fetchAndReturnFactura(id: string, organizationId: string): Promise<NextResponse> {
  const result = await fetchFacturaConOrigen(id, organizationId)
  if (!result) {
    return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
  }
  return NextResponse.json(formatFacturaResponse(result))
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
        { error: "Solo administradores pueden eliminar remitos" },
        { status: 403 }
      )
    }

    const { id } = await params

    const result = await fetchFacturaConOrigen(id, organizationId!)
    if (!result) {
      return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
    }
    if (result.organizationId !== organizationId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    const numeroOrigen =
      result.origen === "orden"
        ? result.factura.ordenes_servicio.numero_orden
        : result.factura.ventas.numero_venta

    // --- Atomic RPC path (migration 248) ---
    const { error: rpcError } = await supabaseAdmin.rpc("eliminar_factura_atomica", {
      p_org_id: organizationId!,
      p_factura_id: id,
      p_user_id: userId!,
    })

    if (!rpcError) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: organizationId,
        user_id: userId,
        action: "DELETE_FACTURA",
        entity_type: "factura",
        entity_id: id,
        details: {
          numero_factura: result.factura.numero_factura,
          total: result.factura.total,
          origen: result.origen,
          numeroOrigen,
        },
      })
      return NextResponse.json({ success: true })
    }

    if (isFunctionMissingError(rpcError)) {
      if (result.origen === "venta") {
        // The legacy JS fallback (below) predates venta-sourced invoices and
        // assumes an orden join; eliminar_factura_atomica always exists once
        // migration 292 is applied, so this path is unreachable in practice.
        console.error("[facturacion] eliminar_factura_atomica missing; venta-origin fallback not supported")
        return NextResponse.json(
          { error: "No se pudo eliminar el remito: falta aplicar una migración pendiente" },
          { status: 500 }
        )
      }
      console.warn("[facturacion] eliminar_factura_atomica not found; falling back to JS path")
      return await eliminarFacturaJsFallback({
        id,
        organizationId: organizationId!,
        userId: userId!,
        factura: {
          id: result.factura.id,
          numero_factura: result.factura.numero_factura,
          total: result.factura.total,
          ordenes_servicio: { organization_id: result.organizationId, numero_orden: numeroOrigen },
        },
      })
    }

    // Map known business errors.
    // eliminar_factura_atomica is untouched by migration 295 — it still raises
    // "Factura no encontrada" (feminine), unlike anular_factura_atomica above
    // which migration 295 reworded to "Remito no encontrado". Keep this
    // matching the old wording; do not "fix" it to match the anular handler.
    const msg = rpcError.message ?? ""
    if (msg.includes("no encontrada")) {
      return NextResponse.json({ error: "Remito no encontrado" }, { status: 404 })
    }
    if (msg.includes("No autorizado")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    console.error("[facturacion] Unexpected RPC error (eliminar):", rpcError)
    return NextResponse.json({ error: "Error al eliminar remito" }, { status: 500 })

  } catch (error) {
    console.error("Error deleting factura:", error)
    return NextResponse.json(
      { error: "Error al eliminar remito" },
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
    return NextResponse.json({ error: "Error al eliminar remito" }, { status: 500 })
  }

  // Load cliente_id + sucursal_id from orden
  const { data: fullFactura } = await supabaseAdmin
    .from("facturas")
    .select("ordenes_servicio!inner(cliente_id, sucursal_id)")
    .eq("id", id)
    .single()

  const clienteId = (fullFactura?.ordenes_servicio as any)?.cliente_id
  const sucursalId = (fullFactura?.ordenes_servicio as any)?.sucursal_id ?? null

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
        p_observaciones: `Eliminacion remito ${factura.numero_factura}`,
        // Derived from the parent orden's sucursal_id, not the current
        // operator's active cookie.
        p_sucursal_id: sucursalId,
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
    return NextResponse.json({ error: "Error al eliminar remito" }, { status: 500 })
  }

  const { error: deleteError } = await supabaseAdmin
    .from("facturas")
    .delete()
    .eq("id", id)

  if (deleteError) {
    console.error("[facturacion] Error deleting factura:", deleteError)
    return NextResponse.json({ error: "Error al eliminar remito" }, { status: 500 })
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
