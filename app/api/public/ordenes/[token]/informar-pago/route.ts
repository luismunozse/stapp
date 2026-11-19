import { NextResponse } from "next/server"
import crypto from "node:crypto"
import { z } from "zod"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"
import { getOrderByPublicToken } from "@/lib/public-token"
import { rateLimit } from "@/lib/rate-limit"
import { aplicadoNotasCreditoDeOrden, pendienteOrden } from "@/lib/ordenes/pendiente"
import { formatCurrencyValue, type CurrencyCode } from "@/lib/currency"
import {
  COMPROBANTE_MAX_BYTES,
  EXTENSION_COMPROBANTE,
  METODOS_PAGO_INFORMADO,
  METODO_PAGO_INFORMADO_LABEL,
  detectarMimeComprobante,
  prefijoComprobantesOrden,
  puedeInformarPago,
  redondearMonto,
  requiereComprobante,
} from "@/lib/ordenes/pagos-informados"

const camposSchema = z.object({
  metodo: z.enum(METODOS_PAGO_INFORMADO),
  monto: z.coerce.number().positive("El monto debe ser mayor a 0").max(1_000_000_000),
  nota: z.string().trim().max(300, "La nota no puede superar los 300 caracteres").optional(),
})

/**
 * POST — el cliente avisa desde el seguimiento que pagó (o que paga en
 * efectivo al retirar). Multipart: metodo, monto, nota?, comprobante (archivo,
 * obligatorio salvo efectivo).
 *
 * No registra ningún cobro: deja el aviso PENDIENTE y notifica a los ADMIN del
 * taller, que lo confirman o rechazan desde la orden.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params

    // Un aviso real son uno o dos intentos; esto corta el abuso de storage.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await rateLimit(`pago-informado:${ip}:${token}`, 5, 10 * 60_000)
    if (!rl.success) {
      return NextResponse.json(
        { error: "Demasiados intentos. Esperá unos minutos y volvé a probar." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)) } },
      )
    }

    const { orden, error } = await getOrderByPublicToken(
      token,
      `estado, numero_orden, codigo_orden, dispositivo, cliente_id,
       costo_final, descuento_cobro, total_cobrado,
       notas_credito (monto_aplicado_deuda, anulada),
       clientes (nombre),
       organizations (moneda, cbu_alias)`,
    )
    if (error) return error

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }

    const parsed = camposSchema.safeParse({
      metodo: formData.get("metodo"),
      monto: formData.get("monto"),
      nota: formData.get("nota") || undefined,
    })
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { metodo, nota } = parsed.data
    const monto = redondearMonto(parsed.data.monto)

    const org = orden.organizations as any
    const saldo = redondearMonto(
      Math.max(
        0,
        pendienteOrden({
          costoFinal: Number(orden.costo_final) || 0,
          descuentoCobro: Number(orden.descuento_cobro) || 0,
          totalCobrado: Number(orden.total_cobrado) || 0,
          aplicadoNotasCredito: aplicadoNotasCreditoDeOrden(orden as any),
        }),
      ),
    )

    if (!puedeInformarPago(orden.estado, saldo)) {
      return NextResponse.json({ error: "Esta orden no tiene un pago pendiente para informar" }, { status: 409 })
    }
    if (monto > saldo) {
      return NextResponse.json({ error: "El monto supera el saldo pendiente" }, { status: 400 })
    }
    if (requiereComprobante(metodo) && !(org?.cbu_alias as string | null)?.trim()) {
      return NextResponse.json({ error: "El taller no tiene configurado un alias para transferencias" }, { status: 409 })
    }

    // Un aviso pendiente por vez (el índice único de la 419 lo garantiza igual;
    // esto evita subir un archivo para nada).
    const { data: pendiente, error: pendienteError } = await supabaseAdmin
      .from("pagos_informados")
      .select("id")
      .eq("orden_id", orden.id)
      .eq("estado", "PENDIENTE")
      .maybeSingle()
    if (pendienteError) {
      console.error("[informar-pago] Error leyendo avisos:", pendienteError)
      return NextResponse.json({ error: "No se pudo informar el pago" }, { status: 500 })
    }
    if (pendiente) {
      return NextResponse.json({ error: "Ya informaste un pago; el taller lo está verificando" }, { status: 409 })
    }

    let comprobantePath: string | null = null
    if (requiereComprobante(metodo)) {
      const file = formData.get("comprobante")
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: "Adjuntá el comprobante del pago" }, { status: 400 })
      }
      if (file.size > COMPROBANTE_MAX_BYTES) {
        return NextResponse.json({ error: "El comprobante supera los 5 MB" }, { status: 400 })
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      const mime = detectarMimeComprobante(buffer)
      if (!mime) {
        return NextResponse.json({ error: "El comprobante tiene que ser una imagen (JPG, PNG, WEBP) o un PDF" }, { status: 400 })
      }
      comprobantePath = `${prefijoComprobantesOrden(orden.organization_id, orden.id)}/${Date.now()}-${crypto.randomBytes(12).toString("hex")}.${EXTENSION_COMPROBANTE[mime]}`
      const { error: uploadError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKETS.COMPROBANTES_GASTOS)
        .upload(comprobantePath, buffer, { contentType: mime, upsert: false })
      if (uploadError) {
        console.error("[informar-pago] Error subiendo comprobante:", uploadError)
        return NextResponse.json({ error: "No se pudo subir el comprobante" }, { status: 500 })
      }
    }

    const { data: aviso, error: insertError } = await supabaseAdmin
      .from("pagos_informados")
      .insert({
        organization_id: orden.organization_id,
        orden_id: orden.id,
        metodo,
        monto,
        nota: nota || null,
        comprobante_path: comprobantePath,
      })
      .select("id, created_at")
      .single()

    if (insertError || !aviso) {
      // El archivo ya subió: no dejarlo huérfano.
      if (comprobantePath) {
        await supabaseAdmin.storage.from(STORAGE_BUCKETS.COMPROBANTES_GASTOS).remove([comprobantePath])
      }
      if ((insertError as any)?.code === "23505") {
        return NextResponse.json({ error: "Ya informaste un pago; el taller lo está verificando" }, { status: 409 })
      }
      console.error("[informar-pago] Error guardando aviso:", insertError)
      return NextResponse.json({ error: "No se pudo informar el pago" }, { status: 500 })
    }

    const moneda = ((org?.moneda as string) || "ARS") as CurrencyCode
    const montoTexto = formatCurrencyValue(monto, moneda)
    const codigo = orden.codigo_orden || `#${orden.numero_orden}`
    const clienteNombre = (orden.clientes as any)?.nombre || "El cliente"
    const descripcion =
      metodo === "EFECTIVO"
        ? `${clienteNombre} avisó que paga ${montoTexto} en efectivo al retirar`
        : `${clienteNombre} informó un pago de ${montoTexto} por ${METODO_PAGO_INFORMADO_LABEL[metodo]}`

    // Historial interno de la orden (el seguimiento público no muestra este tipo).
    await supabaseAdmin
      .from("orden_eventos")
      .insert({
        orden_id: orden.id,
        organization_id: orden.organization_id,
        tipo: "PAGO_INFORMADO",
        descripcion,
        metadata: { pagoInformadoId: aviso.id, metodo, monto },
      })
      .then(({ error: e }) => e && console.error("[informar-pago] Error registrando evento:", e))

    // Aviso in-app a los ADMIN: son quienes confirman.
    try {
      const { data: admins } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("organization_id", orden.organization_id)
        .eq("rol", "ADMIN")
      if (admins && admins.length > 0) {
        await supabaseAdmin.from("user_notifications").insert(
          admins.map((u: { id: string }) => ({
            organization_id: orden.organization_id,
            user_id: u.id,
            title: `Pago informado · Orden ${codigo}`,
            body: `${descripcion}. Confirmalo cuando lo veas acreditado.`,
            type: "PAGO_INFORMADO",
            icon: "wallet",
            action_url: `/ordenes/${orden.id}`,
            orden_id: orden.id,
            cliente_id: orden.cliente_id ?? null,
          })),
        )
      }
    } catch (err) {
      console.error("[informar-pago] Error notificando al taller:", err)
    }

    return NextResponse.json(
      { ok: true, avisoPendiente: { monto, metodo, fecha: aviso.created_at } },
      { status: 201 },
    )
  } catch (err) {
    console.error("[informar-pago] Error:", err)
    return NextResponse.json({ error: "No se pudo informar el pago" }, { status: 500 })
  }
}
