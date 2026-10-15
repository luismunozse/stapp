import type { z } from "zod"
import {
  bloqueos,
  etiquetaDeFila,
  filasEnOrden,
  type Fila,
  type GrupoLeido,
  type VariantesState,
} from "@/lib/variantes-filas"
import { LIMITES, redondearPrecio, type guardarGrupoSchema } from "@/lib/variantes-schema"

// PURE and client-importable, like lib/variantes-schema.ts and lib/variantes-filas.ts (it must never
// import lib/variantes-api.ts, which is server-only). The product form turns the variants state into
// the body of PUT /api/inventario/grupos/[id] with `construirCuerpoGrupo`, decides what to do with the
// answer with `interpretarGuardado`, and retries once on a clashing generated code with
// `reasignarCodigosDuplicados`.
//
// The save is FULL-STATE on the server (every active member must be listed, saved or archived), but
// each row only carries what changed: an absent key means "unchanged" to the RPC. That is also why a
// cost the client never saw (a restored row, a role without cost access) must be ABSENT, never 0.

export type CuerpoGrupo = z.input<typeof guardarGrupoSchema>
type CuerpoVariante = CuerpoGrupo["variantes"][number]
type CuerpoCompartidos = NonNullable<CuerpoGrupo["compartidos"]>

/** The shared fields the product form owns (a subset of the 9 the database keeps equal across siblings). */
export interface CompartidosForm {
  categoria: string
  tipoDispositivo: string
  proveedorId: string | null
  diasGarantiaDefault: number | null
  trackeaLotes: boolean
  trackeaSeries: boolean
}

export interface ParametrosCuerpo {
  estado: VariantesState
  /** The state as it was hydrated from the server; null for a group that does not exist yet. */
  original: VariantesState | null
  /** Name of the product = the base name of the group. */
  nombre: string
  compartidos: CompartidosForm
  /** What the shared fields were when the group was loaded; null sends all of them. */
  compartidosPrevios: CompartidosForm | null
  renombrar?: boolean
  depositoId?: string | null
}

export type ResultadoCuerpo = { ok: true; cuerpo: CuerpoGrupo } | { ok: false; motivo: string }

const rechazo = (motivo: string): ResultadoCuerpo => ({ ok: false, motivo })

const sinEspaciosExtremos = (s: string) => s.trim()
const normalizarBarcode = (b: string | null | undefined) => (b == null || b.trim() === "" ? null : b.trim())

/** Fields of a row that exist for any kind of row and are sent when they differ from `base`. */
function camposDeExtra(fila: Fila, base: Fila["extra"] | null, destino: CuerpoVariante) {
  const claves = ["stockMinimo", "stockMaximo", "puntoReorden", "ubicacion"] as const
  for (const clave of claves) {
    const valor = fila.extra[clave]
    if (base ? valor !== base[clave] : valor !== null) (destino as Record<string, unknown>)[clave] = valor
  }
}

function codigoDe(fila: Fila, etiqueta: string): string | ResultadoCuerpo {
  const codigo = sinEspaciosExtremos(fila.codigo)
  return codigo === "" ? rechazo(`Falta el código de "${etiqueta}"`) : codigo
}

/**
 * The PUT body for the group in `estado`. Rows are diffed against `original` (the state as hydrated):
 * a saved row sends only the keys that changed; a new row, or the product being promoted, sends everything;
 * a row brought back from the archive sends code, price and cost ONLY once the user edited them (the client
 * never saw the stored values, so sending its placeholders would overwrite them). Codes and names are
 * trimmed; options with no values are left out. It refuses what the server would refuse and the screen
 * already blocks (a blank or repeated code, units reserved on a row to archive), with the screen's words.
 */
export function construirCuerpoGrupo(p: ParametrosCuerpo): ResultadoCuerpo {
  const { estado, original } = p

  const reservados = bloqueos(estado)
  if (reservados.length > 0) return rechazo(reservados[0].motivo)

  const opciones = estado.opciones.filter((o) => o.valores.length > 0)
  const nombresOpcion = opciones.map((o) => ({ opcion: o, nombre: o.nombre.trim() }))

  const filas = filasEnOrden(estado)
  const activas = filas.filter((f) => !f.archivar)

  const variantes: CuerpoVariante[] = []
  const codigosVistos = new Set<string>()
  for (const fila of activas) {
    const etiqueta = etiquetaDeFila(estado, fila)
    const atributos: CuerpoVariante["atributos"] = []
    for (const { opcion, nombre } of nombresOpcion) {
      const valor = opcion.valores.find((v) => fila.valorIds.includes(v.id))
      if (!valor) return rechazo(`Falta elegir ${nombre} para "${etiqueta}"`)
      atributos.push({ opcion: nombre, valor: valor.texto.trim() })
    }

    const cuerpo: CuerpoVariante = { id: fila.id, atributos }
    const previa = original?.filas[fila.id]
    const esRestaurada = !previa && fila.restaurada === true

    if (previa) {
      // A saved row: only what changed.
      const codigo = sinEspaciosExtremos(fila.codigo)
      if (codigo !== sinEspaciosExtremos(previa.codigo)) {
        if (codigo === "") return rechazo(`Falta el código de "${etiqueta}"`)
        cuerpo.codigo = codigo
      }
      const barcode = normalizarBarcode(fila.barcode)
      if (barcode !== normalizarBarcode(previa.barcode)) cuerpo.barcode = barcode
      if (fila.precioVenta !== previa.precioVenta) cuerpo.precioVenta = redondearPrecio(fila.precioVenta)
      if (estado.costoCargado && typeof fila.precioCompra === "number" && fila.precioCompra !== previa.precioCompra) {
        cuerpo.precioCompra = redondearPrecio(fila.precioCompra)
      }
      camposDeExtra(fila, previa.extra, cuerpo)
    } else if (esRestaurada) {
      // Brought back from the archive: the stored code, price and cost are unknown here.
      if (fila.codigoTocado) {
        const codigo = codigoDe(fila, etiqueta)
        if (typeof codigo !== "string") return codigo
        cuerpo.codigo = codigo
      }
      if (fila.precioTocado) cuerpo.precioVenta = redondearPrecio(fila.precioVenta)
      if (estado.costoCargado && typeof fila.precioCompra === "number") cuerpo.precioCompra = redondearPrecio(fila.precioCompra)
      const barcode = normalizarBarcode(fila.barcode)
      if (barcode !== null) cuerpo.barcode = barcode
      camposDeExtra(fila, null, cuerpo)
    } else {
      // A new row, or the standalone product that becomes one: everything.
      const codigo = codigoDe(fila, etiqueta)
      if (typeof codigo !== "string") return codigo
      cuerpo.codigo = codigo
      const barcode = normalizarBarcode(fila.barcode)
      if (barcode !== null) cuerpo.barcode = barcode
      cuerpo.precioVenta = redondearPrecio(fila.precioVenta)
      if (estado.costoCargado && typeof fila.precioCompra === "number") cuerpo.precioCompra = redondearPrecio(fila.precioCompra)
      if (!fila.existente && fila.stockInicial > 0) cuerpo.stockInicial = fila.stockInicial
      camposDeExtra(fila, null, cuerpo)
    }

    const codigoEnviado = cuerpo.codigo ?? (previa ? sinEspaciosExtremos(previa.codigo) : "")
    if (codigoEnviado !== "") {
      const clave = codigoEnviado.toLowerCase()
      if (codigosVistos.has(clave)) return rechazo(`El código "${codigoEnviado}" está repetido`)
      codigosVistos.add(clave)
    }
    variantes.push(cuerpo)
  }

  const archivar = filas.filter((f) => f.archivar && f.existente).map((f) => f.id)

  const cuerpo: CuerpoGrupo = {
    grupo: {
      nombre: p.nombre.trim(),
      opciones: nombresOpcion.map(({ opcion, nombre }) => ({ nombre, valores: opcion.valores.map((v) => v.texto.trim()) })),
    },
    variantes,
  }
  if (p.renombrar !== undefined) cuerpo.grupo.renombrar = p.renombrar
  const compartidos = compartidosCambiados(p.compartidos, p.compartidosPrevios)
  if (Object.keys(compartidos).length > 0) cuerpo.compartidos = compartidos
  if (archivar.length > 0) cuerpo.archivar = archivar
  if (p.depositoId) cuerpo.depositoId = p.depositoId
  return { ok: true, cuerpo }
}

function compartidosCambiados(actual: CompartidosForm, previos: CompartidosForm | null): CuerpoCompartidos {
  const resultado: Record<string, unknown> = {}
  for (const clave of Object.keys(actual) as (keyof CompartidosForm)[]) {
    if (previos === null || actual[clave] !== previos[clave]) resultado[clave] = actual[clave]
  }
  return resultado as CuerpoCompartidos
}

// ---------------------------------------------------------------------------------------
// P0035: a generated code clashed with another product
// ---------------------------------------------------------------------------------------

const MAX_CODIGO = LIMITES.codigo

function conSufijo(codigo: string, n: number): string {
  const sufijo = `-${n}`
  const letras = Array.from(codigo)
  const base = letras.length + sufijo.length > MAX_CODIGO ? letras.slice(0, MAX_CODIGO - sufijo.length).join("") : codigo
  return base + sufijo
}

/**
 * The same body with the clashing codes moved to the next free suffix (FX-ROJ becomes FX-ROJ-2), or null when
 * the retry would be pointless: none of the clashing codes is in the body, or one of them belongs to a row the
 * user typed or that is already saved (those are decisions, not accidents). The input is never mutated.
 */
export function reasignarCodigosDuplicados(cuerpo: CuerpoGrupo, estado: VariantesState, codigos: readonly string[]): CuerpoGrupo | null {
  const choques = new Set(codigos.map((c) => c.trim().toLowerCase()))
  const afectadas = cuerpo.variantes.filter((v) => v.codigo !== undefined && choques.has(v.codigo.toLowerCase()))
  if (afectadas.length === 0) return null
  for (const v of afectadas) {
    const fila = estado.filas[v.id]
    if (!fila || fila.existente || fila.codigoTocado) return null
  }

  const usados = new Set<string>([...choques, ...cuerpo.variantes.flatMap((v) => (v.codigo ? [v.codigo.toLowerCase()] : []))])
  const nuevos = new Map<string, string>()
  for (const v of afectadas) {
    let n = 2
    let candidato = conSufijo(v.codigo as string, n)
    while (usados.has(candidato.toLowerCase())) candidato = conSufijo(v.codigo as string, ++n)
    usados.add(candidato.toLowerCase())
    nuevos.set(v.id, candidato)
  }
  return {
    ...cuerpo,
    variantes: cuerpo.variantes.map((v) => (nuevos.has(v.id) ? { ...v, codigo: nuevos.get(v.id) } : v)),
  }
}

// ---------------------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------------------

export type SalidaGuardado =
  /** Committed. `lectura` is the group as the server reads it now, or null when the server could not re-read it: GET, never re-send. */
  | { tipo: "guardado"; lectura: GrupoLeido | null }
  | { tipo: "codigo-duplicado"; codigos: string[]; mensaje: string }
  /** A member of the group was missing from the save (somebody changed it): reload the group. */
  | { tipo: "recargar"; mensaje: string }
  /** The migration is not applied yet: the section locks. */
  | { tipo: "pendiente"; mensaje: string }
  | { tipo: "error"; mensaje: string }

const MENSAJE_POR_DEFECTO = "No pudimos guardar las variantes. Probá de nuevo."
const MENSAJE_PENDIENTE = "Variantes todavía no está disponible"

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

/** What the form does with the answer of the save. */
export function interpretarGuardado(status: number, cuerpo: unknown): SalidaGuardado {
  const datos = esObjeto(cuerpo) ? cuerpo : {}
  const mensaje = typeof datos.error === "string" && datos.error !== "" ? datos.error : MENSAJE_POR_DEFECTO

  if (status >= 200 && status < 300) {
    const esLectura = esObjeto(datos.grupo) && Array.isArray(datos.variantes) && Array.isArray(datos.archivadas)
    return { tipo: "guardado", lectura: esLectura ? (datos as unknown as GrupoLeido) : null }
  }
  if (status === 503 || datos.code === "MIGRACION_PENDIENTE") {
    return { tipo: "pendiente", mensaje: typeof datos.error === "string" && datos.error !== "" ? datos.error : MENSAJE_PENDIENTE }
  }
  if (datos.code === "CODIGO_DUPLICADO") {
    const codigos = Array.isArray(datos.codigos) ? datos.codigos.filter((c): c is string => typeof c === "string") : []
    return { tipo: "codigo-duplicado", codigos, mensaje }
  }
  if (datos.code === "MIEMBROS_FALTANTES") return { tipo: "recargar", mensaje }
  return { tipo: "error", mensaje }
}
