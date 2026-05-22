import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const plantillasSchema = z
  .object({
    comprobante_venta: z.string().max(2000).optional(),
    comprobante_venta_corto: z.string().max(500).optional(),
  })
  .optional()

const configSchema = z.object({
  notificacionesEmail: z.boolean().optional(),
  notificacionesWhatsapp: z.boolean().optional(),
  diasRecordatorio: z.number().int().min(1).max(30).optional(),
  notifStockBajo: z.boolean().optional(),
  plantillasWhatsapp: plantillasSchema,
})

export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("notificaciones_email, notificaciones_whatsapp, dias_recordatorio, notif_stock_bajo, plantillas_whatsapp")
      .eq("id", organizationId!)
      .single()

    return NextResponse.json({
      notificacionesEmail: org?.notificaciones_email,
      notificacionesWhatsapp: org?.notificaciones_whatsapp,
      diasRecordatorio: org?.dias_recordatorio,
      notifStockBajo: org?.notif_stock_bajo ?? true,
      plantillasWhatsapp: org?.plantillas_whatsapp ?? {},
    })
  } catch (error) {
    console.error("Error fetching notification config:", error)
    return NextResponse.json(
      { error: "Error al obtener configuracion" },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const data = configSchema.parse(body)

    const updateData: Record<string, any> = {}
    if (data.notificacionesEmail !== undefined) updateData.notificaciones_email = data.notificacionesEmail
    if (data.notificacionesWhatsapp !== undefined) updateData.notificaciones_whatsapp = data.notificacionesWhatsapp
    if (data.diasRecordatorio !== undefined) updateData.dias_recordatorio = data.diasRecordatorio
    if (data.notifStockBajo !== undefined) updateData.notif_stock_bajo = data.notifStockBajo

    if (data.plantillasWhatsapp !== undefined) {
      const { data: current } = await supabaseAdmin
        .from("organizations")
        .select("plantillas_whatsapp")
        .eq("id", organizationId!)
        .single()
      const merged = { ...(current?.plantillas_whatsapp ?? {}), ...data.plantillasWhatsapp }
      for (const k of Object.keys(merged)) {
        if (merged[k] === "" || merged[k] == null) delete merged[k]
      }
      updateData.plantillas_whatsapp = merged
    }

    const { data: org } = await supabaseAdmin
      .from("organizations")
      .update(updateData)
      .eq("id", organizationId!)
      .select("notificaciones_email, notificaciones_whatsapp, dias_recordatorio, notif_stock_bajo, plantillas_whatsapp")
      .single()

    return NextResponse.json({
      notificacionesEmail: org?.notificaciones_email,
      notificacionesWhatsapp: org?.notificaciones_whatsapp,
      diasRecordatorio: org?.dias_recordatorio,
      notifStockBajo: org?.notif_stock_bajo ?? true,
      plantillasWhatsapp: org?.plantillas_whatsapp ?? {},
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating notification config:", error)
    return NextResponse.json(
      { error: "Error al actualizar configuracion" },
      { status: 500 }
    )
  }
}
