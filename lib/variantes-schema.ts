import { z } from "zod"
import { claveCombinacion } from "@/lib/variantes"

// PURE and client-importable (no next/server, no server-only): the request side of
// PUT /api/inventario/grupos/[id]. A strict schema, the camelCase to snake_case mapper that
// builds the arguments of the save RPC `guardar_grupo_variantes` (migration 361) and the
// Spanish copy of the validation messages. The route uses it to validate and the product form
// (PR9) imports it to validate before sending. The server-only half (RPC error map, retry,
// 503, HTTP answers) lives in lib/variantes-api.ts.
//
// The RPC is the authority for every cap: the schema rejects the same inputs earlier, with
// a Spanish message and a 400. The caps below mirror the RPC's; a test reads the RPC text
// so a drift fails there. Strings are measured in code points because Postgres
// char_length() counts characters, not UTF-16 units.
//
// CONCURRENCY. There is no version check: two forms saving the same group are
// last-write-wins on every member field, the group name and the options. What the RPC
// does catch is a stale form that leaves a member out (409 MIEMBROS_FALTANTES).

export const LIMITES = {
  opciones: 3,
  valoresPorOpcion: 100,
  combinaciones: 100,
  filas: 100,
  archivar: 100,
  nombreGrupo: 200,
  nombreOpcion: 100,
  valor: 100,
  codigo: 100,
  barcode: 100,
  ubicacion: 100,
  descripcion: 2000,
  texto: 200,
  // Ids are 25 characters (c + 24 hex); the RPC sets no cap, a generous one keeps a URL-sized id out of the snapshot query.
  id: 100,
  precioMax: 99_999_999.99,
  enteroMax: 999_999_999,
} as const

const SEPARADOR = String.fromCharCode(31)

const longitud = (s: string) => Array.from(s).length
// btrim() without a character list removes spaces only, unlike String.prototype.trim().
const sinEspacios = (s: string) => s.replace(/^ +| +$/g, "")
const claveDe = (texto: string) => claveCombinacion([{ opcion: "", valor: texto }])

/**
 * Rounds a price to 2 decimals the way a person would (1.005 -> 1.01), not the way the
 * float sits in memory: the RPC refuses more than 2 decimals.
 */
export function redondearPrecio(n: number): number {
  const texto = String(n)
  const centavos = texto.includes("e") ? n * 100 : Number(`${texto}e2`)
  return Math.round(centavos) / 100
}

// A NUL character cannot be stored in a Postgres text: PostgREST answers a 500 for it.
const NUL = String.fromCharCode(0)
const sinNul = (s: string) => !s.includes(NUL)
const CARACTER_NO_ADMITIDO = "Hay un texto con un carácter que no se admite"

const textoLibre = (max: number, mensaje: string) =>
  z
    .string()
    .refine((s) => longitud(s) <= max, mensaje)
    .refine(sinNul, CARACTER_NO_ADMITIDO)
const textoNoVacio = (max: number, vacio: string, largo: string) =>
  z
    .string()
    .refine((s) => s.trim() !== "", vacio)
    .refine((s) => longitud(s) <= max, largo)
    .refine(sinNul, CARACTER_NO_ADMITIDO)

const entero = z
  .number()
  .int("Tiene que ser un número entero")
  .min(0, "No puede ser negativo")
  .max(LIMITES.enteroMax, "El número es demasiado grande")

const precio = z
  .number()
  .finite()
  .min(0, "El precio no puede ser negativo")
  .transform(redondearPrecio)
  .pipe(z.number().max(LIMITES.precioMax, "El precio es demasiado grande"))

const valor = textoNoVacio(LIMITES.valor, "Los valores no pueden estar vacíos", "Cada valor puede tener hasta 100 caracteres").refine(
  (v) => !v.includes(SEPARADOR),
  "Hay un valor con un carácter que no se admite"
)
const nombreOpcion = textoNoVacio(
  LIMITES.nombreOpcion,
  "Cada opción necesita un nombre",
  "El nombre de una opción puede tener hasta 100 caracteres"
)
const idTexto = textoNoVacio(LIMITES.id, "Falta un identificador", "Un identificador es demasiado largo")

const SIN_CAMPOS_EXTRA = "Hay datos que no se pueden guardar con las variantes"

const opcionSchema = z
  .object({
    nombre: nombreOpcion,
    valores: z
      .array(valor)
      .min(1, "Cada opción necesita al menos un valor")
      .max(LIMITES.valoresPorOpcion, "Una opción puede tener hasta 100 valores"),
  })
  .strict(SIN_CAMPOS_EXTRA)

const grupoSchema = z
  .object({
    nombre: textoNoVacio(LIMITES.nombreGrupo, "El nombre del producto es requerido", "El nombre puede tener hasta 200 caracteres"),
    opciones: z
      .array(opcionSchema)
      .min(1, "Elegí al menos una opción")
      .max(LIMITES.opciones, "Un producto puede tener hasta 3 opciones"),
    renombrar: z.boolean().optional(),
  })
  .strict(SIN_CAMPOS_EXTRA)

const compartidosSchema = z
  .object({
    descripcion: textoLibre(LIMITES.descripcion, "La descripción puede tener hasta 2000 caracteres").nullable().optional(),
    categoria: textoNoVacio(LIMITES.texto, "La categoría es requerida", "La categoría puede tener hasta 200 caracteres").optional(),
    tipoDispositivo: textoLibre(LIMITES.texto, "El tipo puede tener hasta 200 caracteres").nullable().optional(),
    proveedor: textoLibre(LIMITES.texto, "El proveedor puede tener hasta 200 caracteres").nullable().optional(),
    // A blank id would reach the RPC and come back as a misleading 404: reject it here.
    proveedorId: textoNoVacio(LIMITES.texto, "El proveedor no es válido", "El proveedor no es válido").nullable().optional(),
    diasGarantiaDefault: entero.nullable().optional(),
    trackeaLotes: z.boolean().optional(),
    trackeaSeries: z.boolean().optional(),
    diasAlertaVencimiento: entero.nullable().optional(),
  })
  .strict(SIN_CAMPOS_EXTRA)

const atributoSchema = z.object({ opcion: nombreOpcion, valor }).strict(SIN_CAMPOS_EXTRA)

const varianteSchema = z
  .object({
    id: idTexto,
    atributos: z
      .array(atributoSchema)
      .min(1, "Cada variante necesita un valor por cada opción")
      .max(LIMITES.opciones, "Cada variante necesita un valor por cada opción"),
    codigo: textoNoVacio(LIMITES.codigo, "El código es requerido", "El código puede tener hasta 100 caracteres").optional(),
    barcode: textoLibre(LIMITES.barcode, "El código de barras puede tener hasta 100 caracteres").nullable().optional(),
    precioVenta: precio.optional(),
    precioCompra: precio.optional(),
    stockInicial: entero.optional(),
    stockMinimo: entero.nullable().optional(),
    stockMaximo: entero.nullable().optional(),
    puntoReorden: entero.nullable().optional(),
    ubicacion: textoLibre(LIMITES.ubicacion, "La ubicación puede tener hasta 100 caracteres").nullable().optional(),
  })
  .strict(SIN_CAMPOS_EXTRA)
  .superRefine((v, ctx) => {
    if (v.stockMinimo != null && v.stockMaximo != null && v.stockMinimo > v.stockMaximo) {
      ctx.addIssue({ code: "custom", path: ["stockMinimo"], message: "El stock mínimo no puede superar al máximo" })
    }
  })

export const guardarGrupoSchema = z
  .object({
    grupo: grupoSchema,
    compartidos: compartidosSchema.optional(),
    variantes: z.array(varianteSchema).max(LIMITES.filas, "Se pueden guardar hasta 100 variantes"),
    archivar: z.array(idTexto).max(LIMITES.archivar, "Se pueden archivar hasta 100 variantes por vez").optional(),
    depositoId: idTexto.nullable().optional(),
  })
  .strict(SIN_CAMPOS_EXTRA)
  .superRefine((datos, ctx) => {
    const problema = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message })
    const { opciones } = datos.grupo

    const nombres = new Set<string>()
    opciones.forEach((o, i) => {
      const clave = claveDe(o.nombre)
      if (nombres.has(clave)) problema(["grupo", "opciones", i, "nombre"], "Las opciones no pueden repetirse")
      nombres.add(clave)

      const valores = new Set<string>()
      o.valores.forEach((v, j) => {
        const claveValor = claveDe(v)
        if (valores.has(claveValor)) problema(["grupo", "opciones", i, "valores", j], `El valor "${v}" está repetido en ${o.nombre}`)
        valores.add(claveValor)
      })
    })

    const combinaciones = opciones.reduce((total, o) => total * o.valores.length, 1)
    if (combinaciones > LIMITES.combinaciones) {
      problema(["grupo", "opciones"], `Las opciones generan ${combinaciones} combinaciones y el máximo es 100`)
    }

    const ids = new Set<string>()
    const barcodes = new Set<string>()
    datos.variantes.forEach((v, i) => {
      if (v.atributos.length !== opciones.length) {
        problema(["variantes", i, "atributos"], "Cada variante necesita un valor por cada opción")
      } else {
        v.atributos.forEach((a, j) => {
          if (a.opcion !== opciones[j].nombre) {
            problema(["variantes", i, "atributos", j, "opcion"], "Los valores de la variante no siguen el orden de las opciones")
          }
        })
      }
      if (ids.has(v.id)) problema(["variantes", i, "id"], "Hay variantes repetidas")
      ids.add(v.id)

      const barcode = v.barcode == null ? "" : sinEspacios(v.barcode)
      if (barcode !== "") {
        if (barcodes.has(barcode)) problema(["variantes", i, "barcode"], "Hay códigos de barras repetidos")
        barcodes.add(barcode)
      }
    })

    datos.archivar?.forEach((id, k) => {
      if (ids.has(id)) problema(["archivar", k], "Una variante no puede guardarse y archivarse a la vez")
    })
  })

export type GuardarGrupoInput = z.output<typeof guardarGrupoSchema>

const COMPARTIDOS_A_SQL = {
  descripcion: "descripcion",
  categoria: "categoria",
  tipoDispositivo: "tipo_dispositivo",
  proveedor: "proveedor",
  proveedorId: "proveedor_id",
  diasGarantiaDefault: "dias_garantia_default",
  trackeaLotes: "trackea_lotes",
  trackeaSeries: "trackea_series",
  diasAlertaVencimiento: "dias_alerta_vencimiento",
} as const

const FILA_A_SQL = {
  barcode: "barcode",
  precioVenta: "precio_venta",
  precioCompra: "precio_compra",
  stockInicial: "stock_inicial",
  stockMinimo: "stock_minimo",
  stockMaximo: "stock_maximo",
  puntoReorden: "punto_reorden",
  ubicacion: "ubicacion",
} as const

export interface ArgsGuardarGrupo {
  p_org: string
  p_user: string | null
  p_grupo: { id: string; nombre: string; opciones: { nombre: string; valores: string[] }[]; renombrar?: boolean }
  p_compartidos: Record<string, unknown>
  p_variantes: Record<string, unknown>[]
  p_archivar: string[]
  p_deposito_inicial: string | null
}

export interface ContextoGuardarGrupo {
  /** From the session, never from the body. */
  organizationId: string
  userId: string | null
  /** From the URL. */
  grupoId: string
  /** Already validated; null lets the RPC use the principal depot. */
  depositoInicial: string | null
  canViewCost: boolean
  datos: GuardarGrupoInput
}

/** Copies the keys of `origen` that are present (not undefined), renamed by `mapa`. A null is kept: it means "clear". */
function copiarPresentes(origen: Record<string, unknown>, mapa: Record<string, string>, destino: Record<string, unknown>) {
  for (const [camel, snake] of Object.entries(mapa)) {
    if (origen[camel] !== undefined) destino[snake] = origen[camel]
  }
}

/**
 * Builds the RPC arguments. A key the client did not send stays out of the payload
 * (the RPC reads absence as "unchanged"); null is sent as null ("clear"). A role without
 * cost access never sends precio_compra, whatever the body says.
 */
export function argumentosGuardarGrupo(ctx: ContextoGuardarGrupo): ArgsGuardarGrupo {
  const { datos } = ctx
  const p_grupo: ArgsGuardarGrupo["p_grupo"] = {
    id: ctx.grupoId,
    nombre: datos.grupo.nombre,
    opciones: datos.grupo.opciones.map((o) => ({ nombre: o.nombre, valores: o.valores })),
  }
  if (datos.grupo.renombrar !== undefined) p_grupo.renombrar = datos.grupo.renombrar

  const p_compartidos: Record<string, unknown> = {}
  if (datos.compartidos) copiarPresentes(datos.compartidos, COMPARTIDOS_A_SQL, p_compartidos)

  const filaSql: Record<string, string> = { ...FILA_A_SQL }
  if (!ctx.canViewCost) delete filaSql.precioCompra

  const p_variantes = datos.variantes.map((v) => {
    const fila: Record<string, unknown> = {
      id: v.id,
      atributos: v.atributos.map((a) => ({ opcion: a.opcion, valor: a.valor })),
    }
    if (v.codigo !== undefined) fila.codigo = v.codigo
    copiarPresentes(v, filaSql, fila)
    return fila
  })

  return {
    p_org: ctx.organizationId,
    p_user: ctx.userId,
    p_grupo,
    p_compartidos,
    p_variantes,
    p_archivar: datos.archivar ?? [],
    p_deposito_inicial: ctx.depositoInicial,
  }
}

/**
 * Spanish copy for one issue of the schema. The messages the schema sets itself are already
 * Spanish and name the rule, so they pass through; zod's own English defaults ("Expected
 * object, received null") are replaced by neutral copy chosen by the issue code.
 */
export function mensajeDeIssue(issue: z.ZodIssue): string {
  if (issue.code === "custom") return issue.message
  const porDefecto = z.defaultErrorMap(issue, { defaultError: "", data: undefined }).message
  if (issue.message !== porDefecto) return issue.message

  switch (issue.code) {
    case "invalid_type":
      if (issue.received === "undefined") return "Falta un dato requerido"
      switch (issue.expected) {
        case "number":
        case "integer":
        case "float":
        case "bigint":
          return "Tiene que ser un número"
        case "string":
          return "Tiene que ser un texto"
        case "boolean":
          return "Tiene que ser sí o no"
        case "array":
          return "Tiene que ser una lista"
        case "object":
          return "Los datos no tienen el formato esperado"
        default:
          return "Hay un dato con un formato que no corresponde"
      }
    case "too_big":
      if (issue.type === "array" || issue.type === "set") return "Hay demasiados elementos en la lista"
      return issue.type === "string" ? "Hay un texto demasiado largo" : "Hay un número demasiado grande"
    case "too_small":
      if (issue.type === "array" || issue.type === "set") return "Faltan elementos en la lista"
      return issue.type === "string" ? "Hay un texto demasiado corto" : "Hay un número demasiado chico"
    case "unrecognized_keys":
      return SIN_CAMPOS_EXTRA
    default:
      return "Los datos de las variantes no son válidos"
  }
}
