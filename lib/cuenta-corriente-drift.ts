import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"

/**
 * Detector de cuentas corrientes descuadradas.
 *
 * QUÉ PASABA (auditoría contable, punto 1.7)
 *
 * Varios flujos que mueven la cuenta corriente —entregar una orden, cobrar,
 * anular un remito— toleran que el registro en la cuenta corriente falle: si
 * falla, escriben el error en un log técnico y siguen adelante. La entrega se
 * completa, el cobro se registra, y la deuda del cliente queda mal.
 *
 * Alguien construyó el detector (la vista `v_cc_drift`, migración 245), que
 * compara el saldo de cada cliente contra la suma de sus movimientos y lista
 * todo lo que no cierra. Está bien hecha y cubre cuatro tipos de descuadre.
 *
 * Nadie la consultaba. No había tarea automática, ni pantalla, ni alerta. Se
 * escribió y quedó guardada. Un cliente podía deber $40.000 mientras el
 * sistema decía $15.000, y el taller se enteraba cuando el cliente reclamaba.
 *
 * Este módulo la lee. El cron de /api/cron/cc-drift la corre a diario y avisa
 * a los administradores del taller.
 *
 * LA VISTA PUEDE NO EXISTIR
 *
 * La 245 se aplica a mano en el editor SQL de Supabase (lo dice su cabecera),
 * así que puede no estar creada. En ese caso `leerDrift` devuelve
 * `vistaAusente: true` en vez de tirar: un detector que no está instalado no
 * puede romper el cron de todos los talleres.
 */

export type TipoDrift =
  | "SALDO_DESCUADRADO"
  | "ORDEN_ENTREGADA_SIN_CARGO"
  | "VENTA_PENDIENTE_SIN_CARGO"
  | "DEVOLUCION_CC_SIN_CREDITO"

export interface FilaDrift {
  tipo_drift: TipoDrift
  organization_id: string
  cliente_id: string | null
  cliente_nombre: string | null
  referencia_tipo: string | null
  referencia_id: string | null
  valor_documento: number
  valor_ledger: number
  diferencia: number
}

export interface ResultadoDrift {
  filas: FilaDrift[]
  /** true cuando la vista v_cc_drift todavía no está creada en la base. */
  vistaAusente: boolean
}

/** Cuántas filas traer por corrida. Arriba de esto el problema no es de detalle. */
const MAX_FILAS_DRIFT = 500

/**
 * Lee la vista de descuadres. Con `organizationId` la acota a un taller; sin
 * él trae las de todos (lo usa el cron).
 */
export async function leerDrift(organizationId?: string): Promise<ResultadoDrift> {
  let query = supabaseAdmin
    .from("v_cc_drift")
    .select("*")
    .limit(MAX_FILAS_DRIFT)

  if (organizationId) query = query.eq("organization_id", organizationId)

  const { data, error } = await query

  if (error) {
    // 42P01 (relation does not exist) llega como "does not exist", que
    // isMissingColumnError ya reconoce.
    if (isMissingColumnError(error)) {
      console.warn("v_cc_drift no existe todavía (migración 245 sin aplicar)")
      return { filas: [], vistaAusente: true }
    }
    throw new Error(`Error leyendo v_cc_drift: ${error.message}`)
  }

  const filas = (data || []).map((f: any) => ({
    tipo_drift: f.tipo_drift,
    organization_id: f.organization_id,
    cliente_id: f.cliente_id ?? null,
    cliente_nombre: f.cliente_nombre ?? null,
    referencia_tipo: f.referencia_tipo ?? null,
    referencia_id: f.referencia_id ?? null,
    valor_documento: Number(f.valor_documento || 0),
    valor_ledger: Number(f.valor_ledger || 0),
    diferencia: Number(f.diferencia || 0),
  }))

  return { filas, vistaAusente: false }
}

export interface ResumenDrift {
  organizationId: string
  cantidad: number
  /** Suma de las diferencias en valor absoluto: cuánta plata está en duda. */
  montoEnDuda: number
  clientesAfectados: string[]
  porTipo: Record<string, number>
}

/** Agrupa las filas por organización, para que el cron avise una vez por taller. */
export function agruparPorOrganizacion(filas: FilaDrift[]): Map<string, ResumenDrift> {
  const porOrg = new Map<string, ResumenDrift>()

  for (const f of filas) {
    const resumen = porOrg.get(f.organization_id) || {
      organizationId: f.organization_id,
      cantidad: 0,
      montoEnDuda: 0,
      clientesAfectados: [],
      porTipo: {},
    }
    resumen.cantidad++
    resumen.montoEnDuda += Math.abs(f.diferencia)
    resumen.porTipo[f.tipo_drift] = (resumen.porTipo[f.tipo_drift] || 0) + 1
    if (f.cliente_nombre && !resumen.clientesAfectados.includes(f.cliente_nombre)) {
      resumen.clientesAfectados.push(f.cliente_nombre)
    }
    porOrg.set(f.organization_id, resumen)
  }

  for (const resumen of porOrg.values()) {
    resumen.montoEnDuda = Math.round(resumen.montoEnDuda * 100) / 100
  }

  return porOrg
}

/**
 * Texto del aviso, en criollo. El dueño tiene que entender qué hacer sin
 * saber qué es un ledger.
 */
export function mensajeDrift(resumen: ResumenDrift): string {
  const nombres = resumen.clientesAfectados.slice(0, 3).join(", ")
  const resto = resumen.clientesAfectados.length - 3

  const quienes = nombres
    ? `${nombres}${resto > 0 ? ` y ${resto} más` : ""}`
    : `${resumen.cantidad} cliente(s)`

  return (
    `La cuenta corriente de ${quienes} no cuadra: ` +
    `hay ${resumen.cantidad} movimiento(s) con diferencias por ${resumen.montoEnDuda}. ` +
    `Conviene revisar el saldo antes de cobrarles.`
  )
}
