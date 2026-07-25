import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { createAuditLogger } from "@/lib/audit"
import { uploadOrderPhoto, base64ToBuffer } from "@/lib/storage"
import { sucursalParaEscritura } from "@/lib/sucursal"
import { resolveOperador } from "@/lib/operadores"
import { tipoValidaImei } from "@/lib/tipos-dispositivo-config"
import { isValidImei } from "@/lib/imei"

const FEATURE_KEY = "recepcion_multiple"

const fotoSchema = z.object({
  data: z.string(),
  mime: z.string(),
  descripcion: z.string().optional(),
})

const equipoSchema = z.object({
  dispositivo: z.string().min(1, "El dispositivo es requerido"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  marca: z.string().optional(),
  color: z.string().optional(),
  imei: z.string().optional(),
  problemaReportado: z.string().min(1, "El problema es requerido"),
  accesorios: z.string().optional(),
  codigoAccesoDispositivo: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  fotos: z.array(fotoSchema).optional(),
})

const recepcionSchema = z.object({
  clienteId: z.string().min(1, "El cliente es requerido"),
  equipos: z.array(equipoSchema).min(2, "La recepcion multiple requiere al menos 2 equipos"),
  firmaCliente: z.string().optional(),
  firmaMime: z.string().optional(),
  terminosAceptados: z.boolean(),
  recibidoPorId: z.string().nullable().optional(),
  observaciones: z.string().optional(),
  telefonoContacto: z.string().optional(),
})

function generatePublicToken(): string {
  return randomBytes(16).toString("hex")
}

export async function POST(request: Request) {
  try {
    const { error, session, organizationId, userId, role } = await requireAuth()
    if (error) return error

    // Gate de plan. hasPlanFeature aplica los overrides por organizacion.
    const hasFeature = await hasPlanFeature(organizationId!, FEATURE_KEY)
    if (!hasFeature) {
      return NextResponse.json(
        {
          error: "La recepcion de varios equipos esta disponible en el plan Profesional",
          code: "FEATURE_REQUIRED",
          feature: FEATURE_KEY,
        },
        { status: 403 },
      )
    }

    const body = await request.json()
    const data = recepcionSchema.parse(body)

    // Pre-chequeo del limite del plan para el bloque completo. El trigger
    // update_ordenes_count vuelve a validarlo dentro de la transaccion.
    const limitError = await enforcePlanLimit(organizationId!, "ordenes")
    if (limitError) return limitError

    // Validacion de IMEI por tipo, igual que en el alta clasica
    for (const equipo of data.equipos) {
      if (equipo.imei && equipo.imei.trim()) {
        const validaImei = await tipoValidaImei(organizationId!, equipo.tipoDispositivo)
        if (validaImei && !isValidImei(equipo.imei)) {
          return NextResponse.json(
            { error: `El IMEI de ${equipo.dispositivo} debe tener exactamente 15 digitos` },
            { status: 400 },
          )
        }
      }
    }

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const recibidoPor = await resolveOperador(organizationId!, data.recibidoPorId, userId!)

    // Los tokens se generan aca para no depender de pgcrypto en la base
    const equiposRpc = data.equipos.map((equipo) => ({
      dispositivo: equipo.dispositivo,
      tipoDispositivo: equipo.tipoDispositivo,
      marca: equipo.marca ?? null,
      color: equipo.color ?? null,
      imei: equipo.imei ?? null,
      problemaReportado: equipo.problemaReportado,
      accesorios: equipo.accesorios ?? null,
      codigoAccesoDispositivo: equipo.codigoAccesoDispositivo ?? null,
      metadata: equipo.metadata ?? {},
      publicToken: generatePublicToken(),
    }))

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("crear_recepcion_multiple", {
      p_organization_id: organizationId!,
      p_sucursal_id: sucursalId,
      p_cliente_id: data.clienteId,
      p_equipos: equiposRpc,
      p_firma_cliente: data.firmaCliente ?? null,
      p_firma_mime: data.firmaMime ?? null,
      p_terminos: data.terminosAceptados,
      p_recibido_por: recibidoPor,
      p_created_by: userId!,
      p_telefono_contacto: data.telefonoContacto ?? null,
      p_observaciones: data.observaciones ?? null,
    })

    if (rpcError) {
      if (isPlanLimitError(rpcError)) return planLimitErrorResponse(rpcError)
      console.error("Error en crear_recepcion_multiple:", rpcError)
      return NextResponse.json({ error: "Error al crear la recepcion" }, { status: 500 })
    }

    const recepcion = rpcResult.recepcion as { id: string; numero: number; codigo: string }
    const ordenes = rpcResult.ordenes as Array<{
      id: string
      numeroOrden: number
      codigoOrden: string
      dispositivo: string
      publicToken: string
    }>

    // Fotos: fuera de la transaccion (son uploads a Storage). Best-effort, igual
    // que en el alta clasica: una foto que falla no invalida una recepcion firmada.
    for (let i = 0; i < data.equipos.length; i++) {
      const fotos = data.equipos[i].fotos
      const orden = ordenes[i]
      if (!fotos?.length || !orden) continue

      for (const foto of fotos) {
        try {
          const buffer = base64ToBuffer(foto.data)
          const { url, path } = await uploadOrderPhoto(organizationId!, orden.id, buffer, foto.mime)
          await supabaseAdmin.from("fotos_orden").insert({
            orden_id: orden.id,
            url,
            storage_path: path,
            mime: foto.mime,
            size: buffer.length,
            descripcion: foto.descripcion || null,
            tipo: "INGRESO",
          })
        } catch (fotoError) {
          console.error("Error uploading photo:", fotoError)
        }
      }
    }

    // Auditoria: el lote y cada orden
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("recepciones", recepcion.id, {
      codigo: recepcion.codigo,
      cliente_id: data.clienteId,
      equipos: ordenes.length,
    })
    for (const orden of ordenes) {
      await audit.create("ordenes_servicio", orden.id, {
        numero_orden: orden.numeroOrden,
        dispositivo: orden.dispositivo,
        cliente_id: data.clienteId,
        recepcion_id: recepcion.id,
      })
    }

    // Timeline por orden, fire-and-forget
    void (async () => {
      try {
        await supabaseAdmin.from("orden_eventos").insert(
          ordenes.map((orden) => ({
            orden_id: orden.id,
            organization_id: organizationId!,
            tipo: "CAMBIO_ESTADO",
            estado_nuevo: "RECIBIDO",
            descripcion: `Orden creada en la recepcion ${recepcion.codigo}`,
            created_by: userId,
          })),
        )
      } catch (err) {
        console.error("Error inserting orden_eventos (recepcion):", err)
      }
    })()

    // Sin queueNotification a proposito: seria un mensaje por orden. El mensaje
    // agrupado lo dispara el modal de exito (ver el diseño, punto 8).
    return NextResponse.json({ recepcion, ordenes }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error creating recepcion:", error)
    return NextResponse.json({ error: "Error al crear la recepcion" }, { status: 500 })
  }
}
