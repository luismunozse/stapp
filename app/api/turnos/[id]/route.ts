import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { notifyTurno } from "@/lib/turnos/notifications"

const turnoPatchSchema = z.object({
  clienteId: z.string().min(1).nullable().optional(),
  tecnicoId: z.string().min(1).nullable().optional(),
  inicio: z.string().datetime().optional(),
  fin: z.string().datetime().nullable().optional(),
  direccion: z.string().nullable().optional(),
  tipo: z.enum([
    "visita_diagnostico",
    "reparacion_onsite",
    "retiro",
    "entrega",
    "mantenimiento",
  ]).optional(),
  tipoDispositivo: z.string().nullable().optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  problemaReportado: z.string().nullable().optional(),
  fotosPrevias: z.array(z.string()).optional(),
  estado: z.enum([
    "agendado",
    "confirmado",
    "en_camino",
    "realizado",
    "cancelado",
    "no_show",
  ]).optional(),
  notas: z.string().nullable().optional(),
})

function formatTurno(t: any) {
  return {
    id: t.id,
    organizationId: t.organization_id,
    clienteId: t.cliente_id,
    clienteSnapshot: t.cliente_snapshot,
    tecnicoId: t.tecnico_id,
    inicio: t.inicio,
    fin: t.fin,
    direccion: t.direccion,
    tipo: t.tipo,
    tipoDispositivo: t.tipo_dispositivo,
    marca: t.marca,
    modelo: t.modelo,
    problemaReportado: t.problema_reportado,
    fotosPrevias: t.fotos_previas || [],
    estado: t.estado,
    ordenId: t.orden_id,
    notas: t.notas,
    createdBy: t.created_by,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    cliente: t.clientes
      ? { id: t.clientes.id, nombre: t.clientes.nombre, telefono: t.clientes.telefono }
      : null,
    tecnico: t.users
      ? { id: t.users.id, nombre: t.users.nombre }
      : null,
    orden: t.ordenes_servicio
      ? {
          id: t.ordenes_servicio.id,
          numeroOrden: t.ordenes_servicio.numero_orden,
          codigoOrden: t.ordenes_servicio.codigo_orden,
        }
      : null,
  }
}

async function fetchTurno(id: string, organizationId: string) {
  return supabaseAdmin
    .from("turnos")
    .select(`
      *,
      clientes (id, nombre, telefono),
      users:tecnico_id (id, nombre),
      ordenes_servicio:orden_id (id, numero_orden, codigo_orden)
    `)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle()
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await ctx.params
    const { data, error: dbError } = await fetchTurno(id, organizationId!)
    if (dbError) throw dbError
    if (!data) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

    if (role === "TECNICO" && data.tecnico_id !== userId) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 })
    }

    return NextResponse.json(formatTurno(data))
  } catch (err) {
    console.error("Error fetching turno:", err)
    return NextResponse.json({ error: "Error al obtener turno" }, { status: 500 })
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await ctx.params
    const body = await request.json()
    const data = turnoPatchSchema.parse(body)

    const { data: actual } = await fetchTurno(id, organizationId!)
    if (!actual) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

    if (role === "TECNICO") {
      if (actual.tecnico_id !== userId) {
        return NextResponse.json({ error: "Sin acceso" }, { status: 403 })
      }
      // Técnico sólo puede cambiar estado y notas
      const camposPermitidos = new Set(["estado", "notas"])
      for (const k of Object.keys(data)) {
        if (!camposPermitidos.has(k)) {
          return NextResponse.json(
            { error: `Técnico no puede modificar '${k}'` },
            { status: 403 },
          )
        }
      }
    }

    if (actual.orden_id && data.estado && data.estado !== "realizado") {
      return NextResponse.json(
        { error: "Turno ya tiene orden generada; no se puede cambiar estado" },
        { status: 400 },
      )
    }

    if (data.tecnicoId !== undefined && data.tecnicoId !== null) {
      const { data: tecnicoCheck } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("id", data.tecnicoId)
        .eq("organization_id", organizationId!)
        .in("rol", ["TECNICO", "ADMIN"])
        .maybeSingle()
      if (!tecnicoCheck) {
        return NextResponse.json({ error: "Técnico inválido" }, { status: 400 })
      }
    }

    if (data.clienteId !== undefined && data.clienteId !== null) {
      const { data: clienteCheck } = await supabaseAdmin
        .from("clientes")
        .select("id")
        .eq("id", data.clienteId)
        .eq("organization_id", organizationId!)
        .maybeSingle()
      if (!clienteCheck) {
        return NextResponse.json({ error: "Cliente inválido" }, { status: 400 })
      }
    }

    const update: Record<string, any> = {}
    if (data.clienteId !== undefined) update.cliente_id = data.clienteId
    if (data.tecnicoId !== undefined) update.tecnico_id = data.tecnicoId
    if (data.inicio !== undefined) update.inicio = data.inicio
    if (data.fin !== undefined) update.fin = data.fin
    if (data.direccion !== undefined) update.direccion = data.direccion
    if (data.tipo !== undefined) update.tipo = data.tipo
    if (data.tipoDispositivo !== undefined) update.tipo_dispositivo = data.tipoDispositivo
    if (data.marca !== undefined) update.marca = data.marca
    if (data.modelo !== undefined) update.modelo = data.modelo
    if (data.problemaReportado !== undefined) update.problema_reportado = data.problemaReportado
    if (data.fotosPrevias !== undefined) update.fotos_previas = data.fotosPrevias
    if (data.estado !== undefined) update.estado = data.estado
    if (data.notas !== undefined) update.notas = data.notas

    const { data: turno, error: dbError } = await supabaseAdmin
      .from("turnos")
      .update(update)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select(`
        *,
        clientes (id, nombre, telefono),
        users:tecnico_id (id, nombre),
        ordenes_servicio:orden_id (id, numero_orden, codigo_orden)
      `)
      .single()

    if (dbError) throw dbError

    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.update("turnos", id, actual, turno)

    // Notificaciones automáticas según cambios relevantes
    const cambioInicio = data.inicio !== undefined && actual.inicio !== turno.inicio
    const cambioEstadoCancelado = data.estado === "cancelado" && actual.estado !== "cancelado"
    const cambioEstadoEnCamino = data.estado === "en_camino" && actual.estado !== "en_camino"
    if (cambioInicio) {
      notifyTurno(id, "reprogramado").catch((e) => console.error("notif reprog:", e))
    } else if (cambioEstadoCancelado) {
      notifyTurno(id, "cancelado").catch((e) => console.error("notif cancel:", e))
    } else if (cambioEstadoEnCamino) {
      notifyTurno(id, "tecnico_en_camino").catch((e) => console.error("notif camino:", e))
    }

    return NextResponse.json(formatTurno(turno))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error updating turno:", err)
    return NextResponse.json({ error: "Error al actualizar turno" }, { status: 500 })
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error
    if (role === "TECNICO") {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 })
    }

    const { id } = await ctx.params
    const { data: actual } = await fetchTurno(id, organizationId!)
    if (!actual) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

    if (actual.orden_id) {
      return NextResponse.json(
        { error: "Turno tiene orden generada; cancele en lugar de eliminar" },
        { status: 400 },
      )
    }

    const { error: dbError } = await supabaseAdmin
      .from("turnos")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (dbError) throw dbError

    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.delete("turnos", id, actual)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Error deleting turno:", err)
    return NextResponse.json({ error: "Error al eliminar turno" }, { status: 500 })
  }
}
