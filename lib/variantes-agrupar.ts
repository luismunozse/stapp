import { claveCombinacion, nombreVariante } from "@/lib/variantes"
import { LIMITES } from "@/lib/variantes-schema"
import type { AtributoVariante } from "@/types"

// Pure logic of the "Agrupar existentes" dialog (components/inventario/agrupar-dialog.tsx): which
// items may be grouped, which shared fields differ between them, whether the combinations the user
// assigned are complete and unique, the before/after names, and the body of
// PUT /api/inventario/grupos/[id]. Client-safe (no server imports).
//
// The PHOTO is not a shared field: nothing here reads, lists, copies or sends an image (spec VB-3).

/** The part of an inventory row this module reads. `Inventario` is assignable to it. */
export interface ItemAgrupable {
  id: string
  nombre: string
  categoria?: string | null
  descripcion?: string | null
  tipoDispositivo?: string | null
  tipoDispositivoCustom?: { nombre?: string | null } | null
  proveedor?: string | null
  proveedorId?: string | null
  diasGarantiaDefault?: number | null
  trackeaLotes?: boolean | null
  trackeaSeries?: boolean | null
  diasAlertaVencimiento?: number | null
  esKit?: boolean | null
  deletedAt?: string | null
  grupoId?: string | null
  /** The item's OWN photo, for the thumbnail of its row. */
  imagenUrl?: string | null
  imagenRespaldo?: { url: string; etiqueta: string } | null
}

export interface OpcionAgrupar {
  id: string
  nombre: string
  valores: string[]
}

/** itemId -> optionId -> the value picked for that item. */
export type AsignacionAgrupar = Record<string, Record<string, string>>

export type MotivoBloqueo = "kit" | "archivado" | "agrupado"

export const TEXTO_MOTIVO: Record<MotivoBloqueo, string> = {
  kit: "Es un kit y no puede ser una variante",
  archivado: "Está archivado",
  agrupado: "Ya es parte de un grupo de variantes",
}

/** Why an item cannot join a new group, or null when it can. */
export function motivoDeBloqueo(item: ItemAgrupable): MotivoBloqueo | null {
  if (item.esKit) return "kit"
  if (item.deletedAt) return "archivado"
  if (item.grupoId) return "agrupado"
  return null
}

const SEPARADORES = new Set(["-", "–", "—", "/", "|"])

/**
 * The words every name starts with, as the first name spells them: "Funda X Rojo" and
 * "Funda X Azul" give "Funda X". Whole words only ("Funda" is not a prefix of "Fundación"),
 * and a dangling separator ("Funda X -") is dropped. "" when the names share nothing.
 */
export function prefijoComun(nombres: readonly string[]): string {
  const listas = nombres.map((n) => n.trim().split(/\s+/).filter(Boolean))
  if (listas.length === 0 || listas[0].length === 0) return ""
  const comunes: string[] = []
  for (let i = 0; i < listas[0].length; i++) {
    const palabra = listas[0][i]
    if (!listas.every((l) => l[i] !== undefined && l[i].toLowerCase() === palabra.toLowerCase())) break
    comunes.push(palabra)
  }
  while (comunes.length > 0 && SEPARADORES.has(comunes[comunes.length - 1])) comunes.pop()
  return comunes.join(" ")
}

export interface CampoDiferente {
  clave: string
  etiqueta: string
  valores: { itemId: string; texto: string }[]
}

const SIN_DATO = "Sin dato"

const texto = (v: string | null | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)
const dias = (v: number | null | undefined) => (typeof v === "number" ? `${v} ${v === 1 ? "día" : "días"}` : null)
const siNo = (v: boolean | null | undefined) => (v ? "Sí" : "No")

interface Campo {
  clave: string
  etiqueta: string
  /** The text shown, or null for "Sin dato". Two items hold the same value when this (or `igual`) matches. */
  mostrar: (i: ItemAgrupable) => string | null
  /** What is compared, when it is not the shown text. */
  comparar?: (i: ItemAgrupable) => string
}

// The nine shared columns of migration 355, as the form shows them (the provider is one field here).
const CAMPOS: Campo[] = [
  { clave: "categoria", etiqueta: "Categoría", mostrar: (i) => texto(i.categoria) },
  { clave: "descripcion", etiqueta: "Descripción", mostrar: (i) => texto(i.descripcion) },
  {
    clave: "tipoDispositivo",
    etiqueta: "Tipo de dispositivo",
    mostrar: (i) => texto(i.tipoDispositivoCustom?.nombre) ?? texto(i.tipoDispositivo),
  },
  { clave: "proveedor", etiqueta: "Proveedor", mostrar: (i) => texto(i.proveedor), comparar: (i) => texto(i.proveedorId) ?? texto(i.proveedor) ?? "" },
  { clave: "diasGarantiaDefault", etiqueta: "Garantía", mostrar: (i) => dias(i.diasGarantiaDefault) },
  { clave: "trackeaLotes", etiqueta: "Controla lotes", mostrar: (i) => siNo(i.trackeaLotes) },
  { clave: "trackeaSeries", etiqueta: "Controla series", mostrar: (i) => siNo(i.trackeaSeries) },
  { clave: "diasAlertaVencimiento", etiqueta: "Aviso de vencimiento", mostrar: (i) => dias(i.diasAlertaVencimiento) },
]

/** The shared fields whose value is not the same in every item, each with every item's value. */
export function camposQueDifieren(items: readonly ItemAgrupable[]): CampoDiferente[] {
  if (items.length < 2) return []
  const diferentes: CampoDiferente[] = []
  for (const campo of CAMPOS) {
    const comparables = items.map((i) => (campo.comparar ? campo.comparar(i) : (campo.mostrar(i) ?? "")))
    if (new Set(comparables).size < 2) continue
    diferentes.push({
      clave: campo.clave,
      etiqueta: campo.etiqueta,
      valores: items.map((i) => ({ itemId: i.id, texto: campo.mostrar(i) ?? SIN_DATO })),
    })
  }
  return diferentes
}

const claveDe = (t: string) => claveCombinacion([{ opcion: "", valor: t }])

/** Options with trimmed names, trimmed values, no blanks and no repeated values (first spelling wins). */
function opcionesLimpias(opciones: readonly OpcionAgrupar[]) {
  return opciones.map((o) => {
    const vistos = new Set<string>()
    const valores: string[] = []
    for (const crudo of o.valores) {
      const v = crudo.trim()
      if (v === "" || vistos.has(claveDe(v))) continue
      vistos.add(claveDe(v))
      valores.push(v)
    }
    return { id: o.id, nombre: o.nombre.trim(), valores }
  })
}

/**
 * The combination an item was given, in option order, spelled as the option's chip. null while any
 * option has no value, or a value that is not one of the option's chips (a chip removed later).
 */
export function atributosDe(
  opciones: readonly OpcionAgrupar[],
  asignado: Record<string, string> | undefined
): AtributoVariante[] | null {
  const limpias = opcionesLimpias(opciones)
  if (limpias.length === 0) return null
  const atributos: AtributoVariante[] = []
  for (const opcion of limpias) {
    const elegido = asignado?.[opcion.id]?.trim()
    if (!elegido) return null
    const chip = opcion.valores.find((v) => claveDe(v) === claveDe(elegido))
    if (chip === undefined) return null
    atributos.push({ opcion: opcion.nombre, valor: chip })
  }
  return atributos
}

export interface SeguimientoQueSeApaga {
  itemId: string
  tipo: "series" | "lotes"
}

/**
 * Items that track series or lots while the chosen source does not: taking the source's shared fields
 * turns that tracking off for them. The series and lots already loaded are never touched; the dialog
 * checks which of these items actually have some and warns.
 */
export function seguimientoQueSeApaga(items: readonly ItemAgrupable[], fuenteId: string | null): SeguimientoQueSeApaga[] {
  const fuente = items.find((i) => i.id === fuenteId)
  if (!fuente) return []
  const apagados: SeguimientoQueSeApaga[] = []
  for (const item of items) {
    if (item.id === fuente.id) continue
    if (item.trackeaSeries && !fuente.trackeaSeries) apagados.push({ itemId: item.id, tipo: "series" })
    if (item.trackeaLotes && !fuente.trackeaLotes) apagados.push({ itemId: item.id, tipo: "lotes" })
  }
  return apagados
}

/**
 * The mirror case: items that do NOT track series or lots while the chosen source does. After grouping they
 * ask for serial numbers or lots at every sale, and a sale of a product with none loaded is refused.
 */
export function seguimientoQueSePrende(items: readonly ItemAgrupable[], fuenteId: string | null): SeguimientoQueSeApaga[] {
  const fuente = items.find((i) => i.id === fuenteId)
  if (!fuente) return []
  const prendidos: SeguimientoQueSeApaga[] = []
  for (const item of items) {
    if (item.id === fuente.id) continue
    if (!item.trackeaSeries && fuente.trackeaSeries) prendidos.push({ itemId: item.id, tipo: "series" })
    if (!item.trackeaLotes && fuente.trackeaLotes) prendidos.push({ itemId: item.id, tipo: "lotes" })
  }
  return prendidos
}

/**
 * The source to preselect when the products disagree on series or lots tracking: the one that changes the
 * fewest of the others (the majority's). null when they all agree (the choice does not touch stock control,
 * the user picks) or when candidates with different tracking tie (nobody is the obvious one).
 */
export function fuentePorDefecto(items: readonly ItemAgrupable[]): string | null {
  const candidatos = items.filter((i) => motivoDeBloqueo(i) === null)
  const cambios = candidatos.map((c) => ({
    id: c.id,
    n: seguimientoQueSeApaga(candidatos, c.id).length + seguimientoQueSePrende(candidatos, c.id).length,
  }))
  if (cambios.length < 2 || cambios.every((c) => c.n === 0)) return null
  const minimo = Math.min(...cambios.map((c) => c.n))
  const mejores = cambios.filter((c) => c.n === minimo)
  // Several candidates with the same tracking are the same choice: the first stands for them.
  const perfil = (id: string) => {
    const i = candidatos.find((c) => c.id === id)
    return `${!!i?.trackeaSeries}|${!!i?.trackeaLotes}`
  }
  return mejores.every((m) => perfil(m.id) === perfil(mejores[0].id)) ? mejores[0].id : null
}

export interface Problema {
  clave:
    | "sin_opciones"
    | "demasiadas_opciones"
    | "opcion_sin_nombre"
    | "opcion_sin_valores"
    | "opciones_repetidas"
    | "base_vacia"
    | "base_larga"
    | "pocos"
    | "demasiados"
    | "bloqueado"
    | "sin_asignar"
    | "combinacion_repetida"
  mensaje: string
  itemIds?: string[]
}

interface EntradaAgrupar {
  base: string
  opciones: readonly OpcionAgrupar[]
  items: readonly ItemAgrupable[]
  asignacion: AsignacionAgrupar
}

/** Everything that stops the confirm button, in the order the dialog reads best. Empty = ready. */
export function validarAgrupacion({ base, opciones, items, asignacion }: EntradaAgrupar): Problema[] {
  const problemas: Problema[] = []
  const agregar = (p: Problema) => problemas.push(p)
  const limpias = opcionesLimpias(opciones)

  if (limpias.length === 0) agregar({ clave: "sin_opciones", mensaje: "Agregá al menos una opción, por ejemplo Color" })
  if (limpias.length > LIMITES.opciones) agregar({ clave: "demasiadas_opciones", mensaje: "Un producto puede tener hasta 3 opciones" })
  if (limpias.some((o) => o.nombre === "")) agregar({ clave: "opcion_sin_nombre", mensaje: "Cada opción necesita un nombre" })
  if (limpias.some((o) => o.valores.length === 0)) agregar({ clave: "opcion_sin_valores", mensaje: "Cada opción necesita al menos un valor" })
  const nombres = limpias.filter((o) => o.nombre !== "").map((o) => claveDe(o.nombre))
  if (new Set(nombres).size < nombres.length) agregar({ clave: "opciones_repetidas", mensaje: "Las opciones no pueden repetirse" })

  const nombreBase = base.trim()
  if (nombreBase === "") agregar({ clave: "base_vacia", mensaje: "Escribí el nombre del producto" })
  else if (Array.from(nombreBase).length > LIMITES.nombreGrupo) agregar({ clave: "base_larga", mensaje: "El nombre puede tener hasta 200 caracteres" })

  if (items.length < 2) agregar({ clave: "pocos", mensaje: "Elegí al menos dos productos para agrupar" })
  if (items.length > LIMITES.filas) agregar({ clave: "demasiados", mensaje: "Se pueden agrupar hasta 100 productos por vez" })

  const bloqueados = items.filter((i) => motivoDeBloqueo(i) !== null).map((i) => i.id)
  if (bloqueados.length > 0) agregar({ clave: "bloqueado", mensaje: "Hay productos que no se pueden agrupar", itemIds: bloqueados })

  const combinaciones = new Map<string, string[]>()
  const sinAsignar: string[] = []
  for (const item of items) {
    const atributos = atributosDe(opciones, asignacion[item.id])
    if (!atributos) {
      sinAsignar.push(item.id)
      continue
    }
    const clave = claveCombinacion(atributos)
    combinaciones.set(clave, [...(combinaciones.get(clave) ?? []), item.id])
  }
  if (sinAsignar.length > 0) agregar({ clave: "sin_asignar", mensaje: "Elegí la variante de cada producto", itemIds: sinAsignar })
  for (const ids of combinaciones.values()) {
    if (ids.length > 1) agregar({ clave: "combinacion_repetida", mensaje: "Dos productos tienen la misma combinación", itemIds: ids })
  }
  return problemas
}

export interface FilaVistaPrevia {
  id: string
  antes: string
  /** The name after grouping, or null: "Sin cambios" (not renaming, or no combination picked yet). */
  despues: string | null
}

export function vistaPrevia({ base, opciones, items, asignacion, renombrar }: EntradaAgrupar & { renombrar: boolean }): FilaVistaPrevia[] {
  const nombreBase = base.trim()
  return items.map((item) => {
    const atributos = renombrar && nombreBase !== "" ? atributosDe(opciones, asignacion[item.id]) : null
    return { id: item.id, antes: item.nombre, despues: atributos ? nombreVariante(nombreBase, atributos) : null }
  })
}

export interface CuerpoAgrupar {
  grupo: { nombre: string; opciones: { nombre: string; valores: string[] }[]; renombrar: boolean }
  fuenteCompartidosId?: string
  variantes: { id: string; atributos: AtributoVariante[] }[]
}

/**
 * The body of PUT /api/inventario/grupos/{new id}. Each item goes as {id, atributos} ONLY: stock, code,
 * barcode, prices and photo are not sent, so they cannot change. Call it once the assignment validates.
 */
export function construirCuerpoAgrupar(entrada: EntradaAgrupar & { renombrar: boolean; fuenteId: string | null }): CuerpoAgrupar {
  const { base, opciones, items, asignacion, renombrar, fuenteId } = entrada
  const cuerpo: CuerpoAgrupar = {
    grupo: {
      nombre: base.trim(),
      opciones: opcionesLimpias(opciones).map(({ nombre, valores }) => ({ nombre, valores })),
      renombrar,
    },
    variantes: items.map((item) => ({ id: item.id, atributos: atributosDe(opciones, asignacion[item.id]) ?? [] })),
  }
  if (fuenteId) cuerpo.fuenteCompartidosId = fuenteId
  return cuerpo
}
