import { supabaseAdmin } from "@/lib/supabase"
import {
  DEFAULT_TIMEZONE,
  dateRangeUtc,
  getZonedParts,
  monthRangeUtc,
  zonaHorariaValida,
} from "@/lib/timezone"

/**
 * Resolución del período de los reportes de Finanzas, en la zona horaria del
 * taller.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Las tres solapas de Finanzas (Resumen, Estado de Resultados, Ingresos)
 * comparten el mismo selector de período, pero cada endpoint resolvía las
 * fechas por su cuenta y las tres lo hacían con el reloj del proceso:
 *
 *     new Date(desdeParam + "T00:00:00")
 *
 * Sin offset, eso lo resuelve el server. En Vercel el server está en UTC, así
 * que para una org en UTC-3 "septiembre" iba del 31/08 21:00 al 30/09 21:00
 * locales: todo lo cobrado de noche el último día del mes caía en el mes
 * siguiente. Caja —que sí usaba la tz de la org— nunca iba a cerrar contra
 * Finanzas, y el dueño tenía dos pantallas dándole números distintos.
 *
 * `comparativa-ingresos` ya lo había resuelto bien por su lado. Esto es esa
 * misma decisión, en un solo lugar, para que las tres solapas no se puedan
 * volver a desincronizar.
 */

export interface PeriodoResuelto {
  /** Zona horaria de la org, ya validada contra Intl. */
  tz: string
  /** Inicio del período: medianoche local del primer día, como instante UTC. */
  desdeISO: string
  /** Fin del período: último ms del último día local, como instante UTC. */
  hastaISO: string
}

/** Lee la zona horaria de la organización. Cae al default si falta o es inválida. */
export async function zonaHorariaOrg(organizationId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("zona_horaria")
    .eq("id", organizationId)
    .single()
  return zonaHorariaValida(data?.zona_horaria)
}

/**
 * Convierte el par `desde`/`hasta` del selector ("YYYY-MM-DD", inclusive) en
 * los instantes UTC que hay que usar para filtrar columnas TIMESTAMPTZ.
 *
 * Sin parámetros —o con parámetros con formato inválido— devuelve el mes
 * calendario en curso **en la tz de la org**, que es el default que muestra el
 * selector.
 */
export async function resolverPeriodo(
  organizationId: string,
  desdeParam: string | null,
  hastaParam: string | null,
  ahora: Date = new Date()
): Promise<PeriodoResuelto> {
  const tz = await zonaHorariaOrg(organizationId)

  const rango = dateRangeUtc(desdeParam, hastaParam, tz)
  if (rango) {
    return { tz, desdeISO: rango.desde, hastaISO: rango.hasta }
  }

  // Default: mes civil en curso para el taller, no para el server.
  const { year, month } = getZonedParts(ahora, tz)
  const mes = monthRangeUtc(year, month, tz)
  return {
    tz,
    desdeISO: mes.desde.toISOString(),
    hastaISO: mes.hasta.toISOString(),
  }
}

/**
 * Ventana de los últimos `meses` meses calendario terminando en el mes en
 * curso, en la tz de la org. La usa la solapa Resumen (tendencia).
 *
 * Devuelve además las claves "YYYY-MM" de cada mes, en orden, para inicializar
 * los buckets: tienen que salir del mismo calendario que los límites, o el
 * primer y el último mes quedan cortados a medias.
 */
export async function resolverVentanaMeses(
  organizationId: string,
  meses: number,
  ahora: Date = new Date()
): Promise<PeriodoResuelto & { claves: string[]; anioMesInicial: { year: number; month: number } }> {
  const tz = await zonaHorariaOrg(organizationId)
  const { year, month } = getZonedParts(ahora, tz)

  // monthRangeUtc normaliza el overflow vía Date.UTC, así que month - meses + 1
  // puede ser 0 o negativo sin problema.
  const primerMes = monthRangeUtc(year, month - meses + 1, tz)
  const ultimoMes = monthRangeUtc(year, month, tz)

  const claves: string[] = []
  for (let i = 0; i < meses; i++) {
    // Fecha ancla al mediodía UTC del día 1 para leer año y mes sin riesgo de
    // off-by-one al normalizar el overflow de mes.
    const ancla = new Date(Date.UTC(year, month - meses + i, 1, 12, 0, 0))
    claves.push(
      `${ancla.getUTCFullYear()}-${String(ancla.getUTCMonth() + 1).padStart(2, "0")}`
    )
  }

  return {
    tz,
    desdeISO: primerMes.desde.toISOString(),
    hastaISO: ultimoMes.hasta.toISOString(),
    claves,
    anioMesInicial: { year, month: month - meses + 1 },
  }
}

export { DEFAULT_TIMEZONE }
