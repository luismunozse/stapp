import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

// GET - Obtener órdenes con cobro pendiente de un cliente
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, session, role } = await requireAuth()
    if (error) return error

    const { id: clienteId } = await params

    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const sid = filtro.verTodas ? null : filtro.sucursalId

    let query = supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, codigo_orden, dispositivo, costo_final, total_cobrado, estado_cobro, descuento_cobro, estado")
      .eq("organization_id", organizationId!)
      .eq("cliente_id", clienteId)
      .in("estado_cobro", ["PENDIENTE", "PARCIAL"])
      .not("costo_final", "is", null)
      .gt("costo_final", 0)
      .order("fecha_ingreso", { ascending: false })

    if (sid) query = query.eq("sucursal_id", sid)

    const { data: ordenes, error: dbError } = await query

    if (dbError) throw dbError

    // Una orden cuya deuda ya migró a la cuenta corriente (CARGO con
    // referencia_tipo=ORDEN) no debe listarse como pendiente de cobro acá:
    // get_deuda_cliente_sucursal (mig 309) ya la excluye de deuda_ordenes,
    // reverted or not. Sin este mismo filtro, "Cobrar todo" vuelve a cobrar
    // una deuda que ya vive (o vivió) en cuenta_corriente y acredita plata
    // que el cliente nunca pagó.
    const { data: cargos, error: cargosError } = await supabaseAdmin
      .from("cuenta_corriente")
      .select("referencia_id")
      .eq("organization_id", organizationId!)
      .eq("cliente_id", clienteId)
      .eq("tipo", "CARGO")
      .eq("referencia_tipo", "ORDEN")

    if (cargosError) throw cargosError

    const idsConCargo = new Set((cargos || []).map((c) => c.referencia_id))
    const ordenesCobrables = (ordenes || []).filter((o) => !idsConCargo.has(o.id))

    return NextResponse.json(
      ordenesCobrables.map((o) => ({
        id: o.id,
        numeroOrden: o.numero_orden,
        codigoOrden: o.codigo_orden,
        dispositivo: o.dispositivo,
        costoFinal: parseFloat(o.costo_final || "0"),
        totalCobrado: parseFloat(o.total_cobrado || "0"),
        descuentoCobro: parseFloat(o.descuento_cobro || "0"),
        pendiente: parseFloat(o.costo_final || "0") - parseFloat(o.descuento_cobro || "0") - parseFloat(o.total_cobrado || "0"),
        estadoCobro: o.estado_cobro,
        estado: o.estado,
      }))
    )
  } catch (err) {
    console.error("Error fetching ordenes pendientes:", err)
    return NextResponse.json({ error: "Error al obtener órdenes pendientes" }, { status: 500 })
  }
}
