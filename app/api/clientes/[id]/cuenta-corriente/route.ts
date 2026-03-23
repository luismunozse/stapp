import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// GET - Obtener saldo y movimientos de cuenta corriente del cliente
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: clienteId } = await params

    // Obtener saldo actual
    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from("clientes")
      .select("id, nombre, saldo_cuenta")
      .eq("id", clienteId)
      .eq("organization_id", organizationId!)
      .single()

    if (clienteError || !cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

    // Obtener movimientos recientes
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)
    const page = parseInt(searchParams.get("page") || "1")
    const offset = (page - 1) * limit

    const { data: movimientos, error: movError, count } = await supabaseAdmin
      .from("cuenta_corriente")
      .select("*", { count: "exact" })
      .eq("organization_id", organizationId!)
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (movError) throw movError

    return NextResponse.json({
      saldo: parseFloat(cliente.saldo_cuenta || "0"),
      clienteNombre: cliente.nombre,
      movimientos: (movimientos || []).map(m => ({
        id: m.id,
        tipo: m.tipo,
        monto: parseFloat(m.monto),
        saldoPosterior: parseFloat(m.saldo_posterior),
        metodoPago: m.metodo_pago,
        referenciaTipo: m.referencia_tipo,
        referenciaId: m.referencia_id,
        numeroReferencia: m.numero_referencia,
        observaciones: m.observaciones,
        createdAt: m.created_at,
      })),
      total: count || 0,
      page,
      limit,
    })
  } catch (error) {
    console.error("Error fetching cuenta corriente:", error)
    return NextResponse.json({ error: "Error al obtener cuenta corriente" }, { status: 500 })
  }
}

const depositoSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "OTRO"]),
  numeroReferencia: z.string().optional(),
  observaciones: z.string().optional(),
})

// POST - Registrar depósito a cuenta corriente
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden registrar depósitos" },
        { status: 403 }
      )
    }

    const { id: clienteId } = await params
    const body = await request.json()
    const data = depositoSchema.parse(body)

    const { data: result, error: rpcError } = await supabaseAdmin.rpc(
      "depositar_cuenta_corriente",
      {
        p_org_id: organizationId!,
        p_cliente_id: clienteId,
        p_monto: data.monto,
        p_metodo_pago: data.metodoPago,
        p_numero_referencia: data.numeroReferencia || null,
        p_observaciones: data.observaciones || null,
        p_usuario_id: userId!,
      }
    )

    if (rpcError) {
      console.error("Error en depositar_cuenta_corriente:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Error al registrar depósito" },
        { status: 400 }
      )
    }

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error creating deposito:", error)
    return NextResponse.json({ error: "Error al registrar depósito" }, { status: 500 })
  }
}
