import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"

const clienteSnapshotSchema = z.object({
  nombre: z.string().min(1),
  telefono: z.string().min(1),
  email: z.string().email().nullable().optional(),
  direccion: z.string().nullable().optional(),
  dni: z.string().nullable().optional(),
})

const turnoCreateSchema = z.object({
  clienteId: z.string().min(1).optional(),
  clienteSnapshot: clienteSnapshotSchema.optional(),
  tecnicoId: z.string().min(1).optional(),
  inicio: z.string().datetime(),
  fin: z.string().datetime().optional(),
  direccion: z.string().optional(),
  tipo: z.enum([
    "visita_diagnostico",
    "reparacion_onsite",
    "retiro",
    "entrega",
    "mantenimiento",
  ]).default("visita_diagnostico"),
  tipoDispositivo: z.string().optional(),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  problemaReportado: z.string().optional(),
  fotosPrevias: z.array(z.string()).optional(),
  notas: z.string().optional(),
}).refine(
  (d) => d.clienteId || d.clienteSnapshot,
  { message: "Debe indicar clienteId o clienteSnapshot" },
)

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

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const desde = searchParams.get("desde") || ""
    const hasta = searchParams.get("hasta") || ""
    const tecnicoId = searchParams.get("tecnicoId") || ""
    const estado = searchParams.get("estado") || ""
    const conOrden = searchParams.get("conOrden") || ""

    let query = supabaseAdmin
      .from("turnos")
      .select(`
        *,
        clientes (id, nombre, telefono),
        users:tecnico_id (id, nombre),
        ordenes_servicio:orden_id (id, numero_orden, codigo_orden)
      `)
      .eq("organization_id", organizationId!)
      .order("inicio", { ascending: true })

    if (role === "TECNICO") {
      query = query.eq("tecnico_id", userId!)
    } else if (tecnicoId) {
      query = query.eq("tecnico_id", tecnicoId)
    }
    if (estado) query = query.eq("estado", estado)
    if (conOrden === "sin") query = query.is("orden_id", null)
    if (conOrden === "con") query = query.not("orden_id", "is", null)
    if (desde) query = query.gte("inicio", `${desde}T00:00:00`)
    if (hasta) query = query.lte("inicio", `${hasta}T23:59:59`)

    const { data, error: dbError } = await query
    if (dbError) throw dbError

    return NextResponse.json({
      turnos: (data || []).map(formatTurno),
    })
  } catch (err) {
    console.error("Error fetching turnos:", err)
    return NextResponse.json({ error: "Error al obtener turnos" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    // Verificar módulo agenda activo
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("modulo_agenda")
      .eq("id", organizationId!)
      .single()
    if (!org?.modulo_agenda) {
      return NextResponse.json(
        { error: "Módulo de agenda no activado para esta organización" },
        { status: 403 },
      )
    }

    const body = await request.json()
    const data = turnoCreateSchema.parse(body)

    // Si rol TECNICO, sólo se puede asignar a sí mismo
    let tecnicoAsignadoId: string | null = null
    if (role === "TECNICO") {
      tecnicoAsignadoId = userId!
    } else if (data.tecnicoId) {
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
      tecnicoAsignadoId = data.tecnicoId
    }

    // Validar cliente si se pasó
    if (data.clienteId) {
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

    const { data: turno, error: dbError } = await supabaseAdmin
      .from("turnos")
      .insert({
        organization_id: organizationId!,
        cliente_id: data.clienteId || null,
        cliente_snapshot: data.clienteSnapshot || null,
        tecnico_id: tecnicoAsignadoId,
        inicio: data.inicio,
        fin: data.fin || null,
        direccion: data.direccion || null,
        tipo: data.tipo,
        tipo_dispositivo: data.tipoDispositivo || null,
        marca: data.marca || null,
        modelo: data.modelo || null,
        problema_reportado: data.problemaReportado || null,
        fotos_previas: data.fotosPrevias || [],
        notas: data.notas || null,
        created_by: userId!,
      })
      .select(`
        *,
        clientes (id, nombre, telefono),
        users:tecnico_id (id, nombre),
        ordenes_servicio:orden_id (id, numero_orden, codigo_orden)
      `)
      .single()

    if (dbError) throw dbError

    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("turnos", turno.id, {
      inicio: turno.inicio,
      tecnico_id: turno.tecnico_id,
      cliente_id: turno.cliente_id,
      tipo: turno.tipo,
    })

    return NextResponse.json(formatTurno(turno), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating turno:", err)
    return NextResponse.json({ error: "Error al crear turno" }, { status: 500 })
  }
}
