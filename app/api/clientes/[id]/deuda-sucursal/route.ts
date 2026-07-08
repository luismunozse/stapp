import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

// GET - Deuda combinada (fiado + ordenes) del cliente, filtrada por la sucursal activa.
// Fuente de verdad para el recordatorio de pago por WhatsApp (no usar clientes.saldo_cuenta,
// que es un total global cross-sucursal).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, session, role } = await requireAuth()
    if (error) return error

    const { id: clienteId } = await params

    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from("clientes")
      .select("id")
      .eq("id", clienteId)
      .eq("organization_id", organizationId!)
      .single()

    if (clienteError || !cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const sid = filtro.verTodas ? null : filtro.sucursalId

    const { data, error: rpcError } = await supabaseAdmin.rpc("get_deuda_cliente_sucursal", {
      p_org_id: organizationId!,
      p_cliente_id: clienteId,
      p_sucursal_id: sid,
    })

    if (rpcError) {
      console.error("Error en get_deuda_cliente_sucursal:", rpcError)
      return NextResponse.json({ error: "Error al calcular la deuda del cliente" }, { status: 500 })
    }

    const row = Array.isArray(data) ? data[0] : data

    return NextResponse.json({
      deudaTotal: Number(row?.deuda_total ?? 0),
      deudaFiado: Number(row?.deuda_fiado ?? 0),
      deudaOrdenes: Number(row?.deuda_ordenes ?? 0),
    })
  } catch (err) {
    console.error("Error fetching deuda cliente sucursal:", err)
    return NextResponse.json({ error: "Error al obtener la deuda del cliente" }, { status: 500 })
  }
}
