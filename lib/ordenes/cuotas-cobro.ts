import { supabaseAdmin } from "@/lib/supabase"
import { todayInTimeZone, addMonthsToDateOnly, DEFAULT_TIMEZONE } from "@/lib/timezone"

/**
 * Calendario de cuotas de los cobros de una orden pagados en más de una cuota.
 * No mueve plata: solo agenda los vencimientos. Lo usan el cobro de la orden y
 * el pago registrado desde su remito, que también es un cobro de la orden.
 */
export async function generarCuotasCobros(
  organizationId: string,
  ordenId: string,
  cobros: Array<{ id: string; monto: number; cuotas: number | null }>,
): Promise<void> {
  const enCuotas = cobros.filter((c) => c.cuotas && c.cuotas > 1)
  if (enCuotas.length === 0) return

  // Base de los vencimientos = HOY en la tz de la org. Con new Date() (UTC en
  // Vercel), a las 21h ART la fecha base ya era mañana y las cuotas salían
  // corridas un día.
  const { data: orgTzRow } = await supabaseAdmin
    .from("organizations")
    .select("zona_horaria")
    .eq("id", organizationId)
    .single()
  const baseHoy = todayInTimeZone(orgTzRow?.zona_horaria || DEFAULT_TIMEZONE)

  for (const cobro of enCuotas) {
    const total = cobro.cuotas!
    const montoCuota = cobro.monto / total
    const cuotasInsert = []
    for (let i = 1; i <= total; i++) {
      cuotasInsert.push({
        cobro_id: cobro.id,
        orden_id: ordenId,
        organization_id: organizationId,
        numero_cuota: i,
        total_cuotas: total,
        monto: Math.round(montoCuota * 100) / 100,
        fecha_vencimiento: addMonthsToDateOnly(baseHoy, i),
        pagada: i === 1,
        fecha_pago: i === 1 ? new Date().toISOString() : null,
      })
    }
    await supabaseAdmin.from("cuotas_cobro").insert(cuotasInsert)
  }
}
