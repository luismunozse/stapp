import type Anthropic from "@anthropic-ai/sdk"
import type { ActorCarga } from "@/lib/ordenes/alcance"
import type { ResultadoLectura } from "@/lib/sucursal"

/** Quién pregunta y en qué organización. Sale de la sesión, nunca de lo que manda el modelo. */
export interface ContextoHerramienta {
  actor: ActorCarga
  /** Código ISO de la moneda de la organización (los montos se devuelven como número + esta moneda). */
  moneda: string
  /** Zona horaria de la organización: "hoy" y los rangos de fechas se cuentan en ella. */
  zonaHoraria: string
  /** Filtro de sucursal de las LISTAS para este request (`sucursalParaLectura`, con el selector del ADMIN). */
  filtroLectura: ResultadoLectura
}

/** Lo que devuelve una herramienta: datos para el modelo y cuántas filas salieron (para auditoría). */
export interface ResultadoHerramienta {
  datos: unknown
  filas: number
}

export interface Herramienta {
  definicion: Anthropic.Tool
  /** Lo que ve el usuario mientras corre ("Buscando órdenes…"). Sin etiqueta, uno genérico. */
  etiqueta?: string
  /** Si esta herramienta se ofrece a este actor. Sin permiso, el modelo ni siquiera la ve. */
  disponible: (ctx: ContextoHerramienta) => boolean | Promise<boolean>
  ejecutar: (input: unknown, ctx: ContextoHerramienta) => Promise<ResultadoHerramienta>
}

/** Una llamada registrada en `asistente_mensajes.herramientas`. */
export interface LlamadaRegistrada {
  nombre: string
  input: unknown
  filas: number
  ms: number
  error?: string
}
