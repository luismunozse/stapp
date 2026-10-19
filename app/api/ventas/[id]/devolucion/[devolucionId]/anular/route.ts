import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { formatDevolucion } from "@/lib/db-utils"
import { createAuditLogger } from "@/lib/audit"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"

const anularSchema = z.object({
  motivo: z
    .string({ required_error: "El motivo de la anulación es obligatorio" })
    .trim()
    .min(1, "El motivo de la anulación es obligatorio")
    .max(500, "El motivo no puede tener más de 500 caracteres"),
})

/** Lo que devuelve anular_devolucion_venta (mig 369). El reintento trae solo una parte. */
type ResultadoAnulacion = {
  id: string
  numero: string
  ventaId: string
  anuladaAt: string
  montoDevolucion: number
  montoAplicadoDeuda: number
  montoReembolso: number
  metodoReembolso: string | null
  unidadesDescontadas?: number
  seriesRestauradas?: number
  garantiasReactivadas?: number
  cargoCuentaCorriente?: number
  movimientoCajaId: string | null
  efectivoSinEgreso: boolean
  replayed: boolean
}

// La función no está en la base (369 sin aplicar o caché de PostgREST vieja).
// Solo esos casos: un "does not exist" de otra cosa es un error real.
function esRpcFaltante(err: { code?: string; message?: string }): boolean {
  const msg = (err.message ?? "").toLowerCase()
  return (
    err.code === "PGRST202" ||
    (err.code === "42883" && msg.includes("anular_devolucion_venta")) ||
    msg.includes("could not find the function")
  )
}

// Lo que la base rechaza (369): el texto se devuelve tal cual, ya está escrito para el taller.
const NO_ENCONTRADA = ["Venta no encontrada", "Nota de crédito no encontrada"]
const BLOQUEOS = [
  "más reciente de la venta",
  "La venta está anulada",
  "(DEV-) no se pueden anular",
  "No hay stock de",
  "ya no está como la dejó",
  "antes de que el sistema guardara",
]

/**
 * POST /api/ventas/[id]/devolucion/[devolucionId]/anular — anula la NC activa
 * más reciente de la venta y deja la venta, el stock, las series, la garantía,
 * la cuenta corriente y la caja como estaban (spec, "Anulación"). Solo ADMIN.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; devolucionId: string }> }
) {
  try {
    // Anular revierte plata, stock y cuenta corriente: solo el ADMIN (spec,
    // Permisos). El vendedor habilitado emite (PR7), no anula.
    const { error, organizationId, userId, role, session } = await requireAdmin()
    if (error) return error

    const { id, devolucionId } = await params

    // El alcance de la venta, igual que emitir: del taller y, si el ADMIN
    // eligió una sucursal, de esa sucursal. Ajena e inexistente dan lo mismo.
    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    let ventaQuery = supabaseAdmin.from("ventas").select("id").eq("id", id).eq("organization_id", organizationId!)
    if (!filtro.verTodas && filtro.sucursalId) ventaQuery = ventaQuery.eq("sucursal_id", filtro.sucursalId)
    const { data: venta } = await ventaQuery.maybeSingle()
    if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })

    const { motivo } = anularSchema.parse(await request.json().catch(() => ({})))

    const { data, error: rpcError } = await supabaseAdmin.rpc("anular_devolucion_venta", {
      p_org_id: organizationId!,
      p_venta_id: id,
      p_devolucion_id: devolucionId,
      p_user_id: userId!,
      p_motivo: motivo,
    })

    if (rpcError) {
      if (esRpcFaltante(rpcError)) {
        console.error("anular_devolucion_venta no disponible:", rpcError)
        return NextResponse.json({ error: "Anular notas de crédito no está disponible en este momento" }, { status: 503 })
      }
      const mensaje = rpcError.message ?? ""
      if (NO_ENCONTRADA.some((f) => mensaje.includes(f))) return NextResponse.json({ error: mensaje }, { status: 404 })
      if (BLOQUEOS.some((f) => mensaje.includes(f))) return NextResponse.json({ error: mensaje }, { status: 409 })
      if (mensaje.includes("motivo de la anulación")) return NextResponse.json({ error: mensaje }, { status: 400 })
      throw rpcError
    }

    const resultado = data as ResultadoAnulacion

    // La NC como la muestra el detalle de la venta, ya anulada.
    const { data: fila } = await supabaseAdmin
      .from("devoluciones_venta")
      .select("*, items_devolucion (*)")
      .eq("id", devolucionId)
      .eq("organization_id", organizationId!)
      .maybeSingle()

    // Un reintento ya se auditó y se avisó la primera vez.
    if (!resultado.replayed) {
      const audit = createAuditLogger(organizationId!, userId!, request)
      await audit.update("notas_credito", devolucionId, { anulada: false }, {
        anulada: true,
        numero: resultado.numero,
        origen: "VENTA",
        venta_id: id,
        motivo,
        monto: resultado.montoDevolucion,
        monto_aplicado_deuda: resultado.montoAplicadoDeuda,
        monto_reembolso: resultado.montoReembolso,
        metodo_reembolso: resultado.metodoReembolso,
        ingreso_caja_id: resultado.movimientoCajaId,
        efectivo_sin_egreso: resultado.efectivoSinEgreso,
      })

      emitWebhookEvent(organizationId!, "nota_credito.anulada", {
        id: devolucionId,
        numero: resultado.numero,
        origen: "VENTA",
        origenId: id,
        motivo,
        monto: resultado.montoDevolucion,
        montoAplicadoDeuda: resultado.montoAplicadoDeuda,
        montoReembolso: resultado.montoReembolso,
        metodoReembolso: resultado.metodoReembolso,
        anuladaAt: resultado.anuladaAt,
      }).catch(() => {})
    }

    return NextResponse.json({ ...resultado, notaCredito: formatDevolucion(fila) }, { status: 200 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error anulando nota de credito:", error)
    return NextResponse.json({ error: "Error al anular la nota de crédito" }, { status: 500 })
  }
}
