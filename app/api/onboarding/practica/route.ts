import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/notifications/queue"
import { sucursalParaEscritura } from "@/lib/sucursal"
import { PRACTICA_NUMERO_ORDEN } from "@/lib/onboarding/practica-shared"
import {
  PRACTICA_CODIGO_ORDEN,
  PRACTICA_ORDEN_SELECT,
  countRealOrders,
  deletePracticeData,
  getPracticaOrden,
  registrarCamino,
  toPracticaOrden,
  type PracticaOrdenRow,
} from "@/lib/onboarding/practica"

// The onboarding practice order. Every query is scoped to the caller's org AND
// es_practica = true, so this endpoint cannot read or change a real order. It
// deliberately does not reuse PUT /api/ordenes/[id] or POST .../entregar: called
// with sinCobro false, entregar charges cuenta corriente (entregar/route.ts:192-211).

// required_error too: a missing field reports "Required" otherwise, not the min(1) text.
const crearSchema = z.object({
  tipoDispositivo: z.string({ required_error: "Elegí el tipo de equipo" }).trim().min(1, "Elegí el tipo de equipo"),
  dispositivo: z
    .string({ required_error: "Contanos qué equipo es" })
    .trim()
    .min(1, "Contanos qué equipo es")
    .max(120, "El nombre del equipo es muy largo"),
  problemaReportado: z
    .string({ required_error: "Contanos qué le pasa" })
    .trim()
    .min(1, "Contanos qué le pasa")
    .max(500, "La descripción es muy larga"),
})

async function leerJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function primerError(error: z.ZodError, fallback: string): string {
  // Field messages are ours (Spanish). A missing body has no path, and an unknown
  // discriminator carries zod's English text: both get the fallback.
  return error.errors.find((e) => e.path.length > 0 && e.code !== "invalid_union_discriminator")?.message ?? fallback
}

async function registrarEvento(
  orgId: string,
  userId: string,
  ordenId: string,
  estadoAnterior: string | null,
  estadoNuevo: string,
  descripcion: string,
  metadata?: Record<string, unknown>
) {
  const { error } = await supabaseAdmin.from("orden_eventos").insert({
    orden_id: ordenId,
    organization_id: orgId,
    tipo: "CAMBIO_ESTADO",
    ...(estadoAnterior ? { estado_anterior: estadoAnterior } : {}),
    estado_nuevo: estadoNuevo,
    descripcion,
    created_by: userId,
    ...(metadata ? { metadata } : {}),
  })
  if (error) console.error("[practica] could not insert orden_evento:", error.message)
}

async function notificar(orgId: string, row: PracticaOrdenRow, estado: string, estadoAnterior: string | undefined) {
  const cliente = row.clientes
  if (!cliente) return
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("nombre, nombre_mostrar, slug, moneda, zona_horaria")
    .eq("id", orgId)
    .single()
  try {
    // Same context shape as POST /api/ordenes (route.ts:573-599). Awaited: the
    // email is the point of the practice, and a fire-and-forget send may be cut
    // off once the response is returned.
    await queueNotification({
      organizationId: orgId,
      sucursalId: row.sucursal_id ?? null,
      ordenId: row.id,
      clienteId: cliente.id,
      tipo: "CAMBIO_ESTADO",
      context: {
        organizationName: org?.nombre_mostrar || org?.nombre || "",
        organizationSlug: org?.slug,
        moneda: org?.moneda || "ARS",
        zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
        // Never the stored phone: the practice must not reach WhatsApp even if
        // the owner later edits the client (send-direct.ts:155 checks it).
        cliente: { id: cliente.id, nombre: cliente.nombre, email: cliente.email, telefono: "" },
        orden: {
          id: row.id,
          numeroOrden: PRACTICA_NUMERO_ORDEN,
          dispositivo: row.dispositivo,
          estado,
          estadoAnterior,
          publicToken: row.public_token,
        },
      },
    })
  } catch (err) {
    console.error("[practica] could not queue notification:", err)
  }
}

interface InsertCause {
  code?: string
  message?: string
}

// Returns the practice that won a concurrent submit. With no winner, the 409 is
// no longer silent: the original error is logged, and sinGanadora can answer
// with a more specific response first.
async function practicaGanadora(
  orgId: string,
  cause: InsertCause,
  sinGanadora?: () => Promise<NextResponse | null>
) {
  const practica = await getPracticaOrden(orgId)
  if (practica) return NextResponse.json({ practica }, { status: 201 })
  console.error("[practica] no winning practice after insert conflict:", cause.code, cause.message)
  const especifica = sinGanadora ? await sinGanadora() : null
  if (especifica) return especifica
  return NextResponse.json(
    { error: "No pudimos preparar la práctica. Probá de nuevo en un momento." },
    { status: 409 }
  )
}

// A practice client conserved for real work keeps telefono = "" and es_practica
// = false, so it collides with the next practice client on UNIQUE(organization_id,
// telefono). It is never reused: it may be a real customer.
async function clienteSinTelefonoBloqueante(orgId: string): Promise<NextResponse | null> {
  const { data } = await supabaseAdmin
    .from("clientes")
    .select("id")
    .eq("organization_id", orgId)
    .eq("es_practica", false)
    .eq("telefono", "")
    .maybeSingle()
  if (!data) return null
  return NextResponse.json(
    { error: "Ya tenés un cliente cargado sin teléfono. Agregale un teléfono para poder repetir la práctica." },
    { status: 409 }
  )
}

export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    return NextResponse.json({ practica: await getPracticaOrden(organizationId!) })
  } catch (err) {
    console.error("Error reading the practice order:", err)
    return NextResponse.json({ error: "No pudimos leer la práctica" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, session, organizationId, userId, role } = await requireAdmin()
    if (error) return error
    const orgId = organizationId!

    const parsed = crearSchema.safeParse(await leerJson(request))
    if (!parsed.success) {
      return NextResponse.json({ error: primerError(parsed.error, "Datos inválidos") }, { status: 400 })
    }
    const data = parsed.data

    // Reports are not filtered because the practice never coexists with real
    // orders. Refusing it here keeps that true.
    if ((await countRealOrders(orgId)) > 0) {
      return NextResponse.json(
        { error: "Ya cargaste órdenes reales: la práctica es para antes de la primera." },
        { status: 409 }
      )
    }

    const { data: tipo } = await supabaseAdmin
      .from("tipos_dispositivo")
      .select("codigo")
      .eq("organization_id", orgId)
      .eq("codigo", data.tipoDispositivo)
      .eq("activo", true)
      .maybeSingle()
    if (!tipo) {
      return NextResponse.json({ error: "Ese tipo de equipo no está disponible" }, { status: 400 })
    }

    const { data: owner } = await supabaseAdmin
      .from("users")
      .select("nombre, email")
      .eq("id", userId!)
      .eq("organization_id", orgId)
      .maybeSingle()
    if (!owner?.email) {
      return NextResponse.json({ error: "No encontramos el email de tu usuario" }, { status: 400 })
    }

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: orgId,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    if (!sucursalId) {
      return NextResponse.json({ error: "La organización no tiene sucursal principal configurada" }, { status: 500 })
    }

    // A second POST replaces the practice.
    await deletePracticeData(orgId)

    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from("clientes")
      .insert({
        organization_id: orgId,
        nombre: owner.nombre || owner.email,
        email: owner.email,
        // telefono is NOT NULL (001_schema.sql:161). Empty, so no WhatsApp path
        // fires: they all check it for truthiness.
        telefono: "",
        acepta_whatsapp: false,
        es_practica: true,
      })
      .select("id")
      .single()
    if (clienteError) {
      // 23505 on UNIQUE(organization_id, telefono): a concurrent submit created
      // the practice client first. Return its practice instead of an error.
      if (clienteError.code === "23505") {
        return await practicaGanadora(orgId, clienteError, () => clienteSinTelefonoBloqueante(orgId))
      }
      throw clienteError
    }

    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .insert({
        numero_orden: PRACTICA_NUMERO_ORDEN,
        codigo_orden: PRACTICA_CODIGO_ORDEN,
        es_practica: true,
        organization_id: orgId,
        sucursal_id: sucursalId,
        cliente_id: cliente.id,
        tipo_dispositivo: data.tipoDispositivo,
        dispositivo: data.dispositivo,
        problema_reportado: data.problemaReportado,
        // Same generator as POST /api/ordenes (route.ts:23-25). Expiry is not
        // set on create there either.
        public_token: randomBytes(16).toString("hex"),
        estado: "RECIBIDO",
        recibido_por: userId,
      })
      .select(PRACTICA_ORDEN_SELECT)
      .single()
    if (ordenError) {
      // Nothing references the client inserted above, so this delete cannot
      // cascade into real data.
      await supabaseAdmin
        .from("clientes")
        .delete()
        .eq("id", cliente.id)
        .eq("organization_id", orgId)
        .eq("es_practica", true)
      // 23505 on UNIQUE(organization_id, numero_orden): the concurrent submit won.
      // 23503 (FK violation): a concurrent submit's deletePracticeData removed
      // the client this submit had just created, so the order insert lost the
      // race the other way around. Same outcome: return the winner's practice.
      // Known and accepted: a later submit can still wipe an earlier finished practice.
      if (ordenError.code === "23505" || ordenError.code === "23503") {
        return await practicaGanadora(orgId, ordenError)
      }
      throw ordenError
    }

    const row = orden as unknown as PracticaOrdenRow
    await registrarEvento(orgId, userId!, row.id, null, "RECIBIDO", "Orden de práctica creada")
    await notificar(orgId, row, "RECIBIDO", undefined)
    await registrarCamino(orgId, "practica")

    return NextResponse.json({ practica: toPracticaOrden(row) }, { status: 201 })
  } catch (err) {
    console.error("Error creating the practice order:", err)
    return NextResponse.json({ error: "No pudimos crear la práctica" }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    await deletePracticeData(organizationId!)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Error deleting the practice order:", err)
    return NextResponse.json({ error: "No pudimos borrar la práctica" }, { status: 500 })
  }
}
