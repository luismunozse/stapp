import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// Devuelve los datos necesarios para pre-llenar el form de creación de orden
// a partir de un turno. Si el turno tiene cliente_snapshot (cliente nuevo no
// registrado), también lo expone para que la UI ofrezca crear cliente primero.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await ctx.params

    const { data: turno, error: dbError } = await supabaseAdmin
      .from("turnos")
      .select(`
        id, estado, orden_id,
        cliente_id, cliente_snapshot,
        tecnico_id, inicio, fin, direccion,
        tipo, tipo_dispositivo, marca, modelo,
        problema_reportado, fotos_previas, notas,
        clientes (id, nombre, telefono, email, direccion, dni)
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .maybeSingle()

    if (dbError) throw dbError
    if (!turno) {
      return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 })
    }
    if (turno.orden_id) {
      return NextResponse.json(
        { error: "Turno ya tiene orden generada", ordenId: turno.orden_id },
        { status: 409 },
      )
    }
    if (role === "TECNICO" && turno.tecnico_id !== userId) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 })
    }

    const cliente = (turno as any).clientes
    const snap = (turno as any).cliente_snapshot

    return NextResponse.json({
      turnoId: turno.id,
      requiereCrearCliente: !turno.cliente_id && !!snap,
      cliente: cliente
        ? {
            id: cliente.id,
            nombre: cliente.nombre,
            telefono: cliente.telefono,
            email: cliente.email,
            direccion: cliente.direccion,
            dni: cliente.dni,
          }
        : null,
      clienteSnapshot: snap || null,
      orden: {
        clienteId: turno.cliente_id,
        tecnicoId: turno.tecnico_id,
        tipoDispositivo: turno.tipo_dispositivo,
        dispositivo: [turno.marca, turno.modelo].filter(Boolean).join(" ") || null,
        marca: turno.marca,
        problemaReportado: turno.problema_reportado,
        observaciones: turno.notas,
        telefonoContacto: cliente?.telefono || snap?.telefono || null,
        fechaPrometida: turno.fin || turno.inicio,
        fotosPrevias: turno.fotos_previas || [],
      },
    })
  } catch (err) {
    console.error("Error fetching prefill-orden:", err)
    return NextResponse.json({ error: "Error al obtener datos" }, { status: 500 })
  }
}
