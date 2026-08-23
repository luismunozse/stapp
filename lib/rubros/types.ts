import type { TipoDispositivoConfig } from "@/types"
import type { TipoChecklist, CategoriaChecklist } from "@/types/database"
import type { Terminologia } from "@/lib/terminologia"

/**
 * Un tipo de equipo dentro de un pack de rubro. Es el mismo shape que una fila
 * de `tipos_dispositivo`, sin los campos que asigna la base (id, organization_id).
 */
export interface RubroTipo {
  /** SCREAMING_SNAKE_CASE. Único dentro del pack; se guarda en `tipos_dispositivo.codigo`. */
  codigo: string
  nombre: string
  /** Prefijo del número de orden (CEL-0001). Único dentro del pack. */
  prefijoOrden: string
  /** Nombre de ícono Lucide. Ver `lib/device-types.ts` para el fallback. */
  icono?: string
  orden: number
  config: TipoDispositivoConfig
}

export interface RubroChecklistItem {
  label: string
  tipo: TipoChecklist
  categoria: CategoriaChecklist
  /** Requerido cuando `tipo` es SELECT: opciones separadas por coma. */
  opciones: string | null
  orden: number
  requerido: boolean
}

export interface RubroChecklist {
  nombre: string
  /** Código del tipo al que se vincula, o null para un checklist sin tipo. */
  tipoCodigo: string | null
  items: RubroChecklistItem[]
}

/**
 * Pack de rubro: todo lo que se siembra cuando una organización se registra.
 *
 * Es la ÚNICA fuente de verdad de la siembra. Antes esto vivía partido entre
 * la función SQL `poblar_tipos_dispositivo_base()` (migraciones 014/021/092) y
 * `ensureTiposExist` en `app/api/tipos-dispositivo/route.ts`, que divergían en
 * silencio. Agregar un rubro es agregar un archivo acá, sin migración.
 */
export interface RubroPack {
  /** kebab-case. Se persiste en `organizations.rubro`. */
  id: string
  nombre: string
  descripcion: string
  /** Nombre de ícono Lucide para el selector del registro. */
  icono: string
  /**
   * Overrides de vocabulario para la org. Solo claves del catálogo de
   * `lib/terminologia.ts`. Vacío = defaults neutrales del sistema.
   */
  terminologia: Terminologia
  tipos: RubroTipo[]
  checklists: RubroChecklist[]
}
