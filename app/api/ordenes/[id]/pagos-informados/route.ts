import { NextResponse } from "next/server"
import { requireCajaAccess } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"
import { firmarReferencias } from "@/lib/storage-privado"
import { prefijoComprobantesOrden } from "@/lib/ordenes/pagos-informados"

/**
 * GET — avisos de pago que el cliente mandó desde el seguimiento, del más
 * nuevo al más viejo, con el comprobante como URL firmada (vence en 1 h).
 * Mismo permiso que cobrar: quien puede confirmar es quien puede verlos.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caja = await requireCajaAccess()
    if (caja.error) return caja.error

    const { id: ordenId } = await params
    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(caja), "comercial", { select: "id" })
    if ("error" in cargada) return cargada.error

    const { data, error } = await supabaseAdmin
      .from("pagos_informados")
      .select("id, metodo, monto, nota, comprobante_path, estado, motivo_rechazo, resuelto_at, created_at")
      .eq("orden_id", ordenId)
      .eq("organization_id", caja.organizationId!)
      .order("created_at", { ascending: false })
      .limit(20)

    if (error) {
      // Sin la migración 419 no hay avisos que mostrar: la orden sigue funcionando.
      console.error("[pagos-informados] Error leyendo avisos:", error)
      return NextResponse.json({ pagos: [] })
    }

    const filas = data ?? []
    const urls = await firmarReferencias(
      "COMPROBANTES_GASTOS",
      filas.map((f: any) => f.comprobante_path),
      { prefijo: prefijoComprobantesOrden(caja.organizationId!, ordenId) },
    )

    return NextResponse.json({
      pagos: filas.map((f: any, i: number) => ({
        id: f.id,
        metodo: f.metodo,
        monto: Number(f.monto),
        nota: f.nota,
        comprobanteUrl: urls[i],
        estado: f.estado,
        motivoRechazo: f.motivo_rechazo,
        resueltoAt: f.resuelto_at,
        createdAt: f.created_at,
      })),
    })
  } catch (err) {
    console.error("[pagos-informados] Error:", err)
    return NextResponse.json({ error: "Error al cargar los pagos informados" }, { status: 500 })
  }
}
