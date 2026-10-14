import { NextResponse } from "next/server"
import { z } from "zod"
import { isMissingColumnError } from "@/lib/db-errors"
import { claveCombinacion } from "@/lib/variantes"

// Request side of PUT /api/inventario/grupos/[id]: a strict schema, the camelCase to
// snake_case mapper that builds the arguments of the save RPC `guardar_grupo_variantes`
// (migration 361), and the map from the RPC's errors to HTTP answers.
//
// The RPC is the authority for every cap: the schema rejects the same inputs earlier, with
// a Spanish message and a 400. The caps below mirror the RPC's; a test reads the RPC text
// so a drift fails there. Strings are measured in code points because Postgres
// char_length() counts characters, not UTF-16 units.
//
// CONCURRENCY. There is no version check: two forms saving the same group are
// last-write-wins on every member field, the group name and the options. What the RPC
// does catch is a stale form that leaves a member out (409 MIEMBROS_FALTANTES). A deadlock
// (40P01) between two saves is retried once and then answered as a retryable 409.

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

const textoLibre = (max: number, mensaje: string) => z.string().refine((s) => longitud(s) <= max, mensaje)
const textoNoVacio = (max: number, vacio: string, largo: string) =>
  z
    .string()
    .refine((s) => s.trim() !== "", vacio)
    .refine((s) => longitud(s) <= max, largo)

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
const idTexto = z.string().refine((s) => s.trim() !== "", "Falta un identificador")

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
    proveedorId: textoLibre(LIMITES.texto, "El proveedor no es válido").nullable().optional(),
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
    depositoId: z.string().min(1).nullable().optional(),
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

// ---- RPC errors -> HTTP -----------------------------------------------------------------

export interface RespuestaError {
  status: number
  body: { error: string; code: string; [dato: string]: unknown }
}

const respuesta = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): RespuestaError => ({
  status,
  body: { error, code, ...extra },
})

const pendiente = () => respuesta(503, "MIGRACION_PENDIENTE", "Variantes todavía no está disponible")

/** While migration 355 or 361 is not applied the group routes answer this instead of a 500. */
export function migracionPendiente() {
  const { status, body } = pendiente()
  return NextResponse.json(body, { status })
}

// Codes that mean "an object of an unapplied migration is missing". isMissingColumnError
// already matches 42703 and PGRST204 by code but reads the rest only by their English text,
// so a bare code or a translated message would slip through without this list.
const CODIGOS_MIGRACION = new Set(["42883", "42P01", "PGRST200", "PGRST202", "PGRST205"])
const CODIGOS_REINTENTABLES = new Set(["40P01", "40001"])

const campo = (error: unknown, nombre: "code" | "message") =>
  typeof error === "object" && error !== null ? String((error as Record<string, unknown>)[nombre] ?? "") : ""

/** Deadlock and serialization failure: another save held the rows, the same call may pass now. */
export function esReintentable(error: unknown): boolean {
  return CODIGOS_REINTENTABLES.has(campo(error, "code"))
}

/**
 * Runs the RPC; on a deadlock it runs it once more (the failed transaction rolled back, so
 * the same arguments are safe: new rows are upserts by client id). A second failure is
 * returned as it is.
 */
export async function conReintento<R extends { error?: unknown }>(llamar: () => PromiseLike<R>): Promise<R> {
  const primero = await llamar()
  return esReintentable(primero.error) ? await llamar() : primero
}

/**
 * The answer for an error of the save RPC, or null when it is not one of ours (the route
 * then answers 500). Known SQLSTATEs come FIRST: a P0002 whose text says "does not exist"
 * is a 404, and only what is left is checked for a missing migration.
 */
export function mapearErrorRpc(error: unknown): RespuestaError | null {
  if (!error || typeof error !== "object") return null
  const code = campo(error, "code")
  const message = campo(error, "message")

  switch (code) {
    case "22023": {
      const faltantes = message.match(/^PAYLOAD_INVALIDO:miembros_faltantes:(.+)$/)
      if (faltantes) {
        return respuesta(409, "MIEMBROS_FALTANTES", "El producto cambió mientras lo editabas. Recargá la pantalla y volvé a intentar", {
          faltantes: faltantes[1].split(",").map((id) => id.trim()).filter(Boolean),
          recargar: true,
        })
      }
      return respuesta(400, "PAYLOAD_INVALIDO", "Los datos de las variantes no son válidos")
    }
    case "P0002":
      return respuesta(404, "NO_ENCONTRADO", "No encontramos el producto o el grupo de variantes")
    case "P0030":
      return respuesta(409, "COMBINACION_DUPLICADA", "Hay dos variantes con la misma combinación")
    case "P0031":
      return respuesta(409, "ITEM_EN_OTRO_GRUPO", "Un producto ya pertenece a otro grupo de variantes")
    case "P0032":
      return respuesta(422, "KIT_NO_PERMITIDO", "Un kit no puede ser una variante")
    case "P0033": {
      const reservado = message.match(/^STOCK_RESERVADO:([^:]+):(\d+)$/)
      return reservado
        ? respuesta(409, "STOCK_RESERVADO", `No se puede archivar la variante: tiene ${reservado[2]} unidades reservadas`, {
            variante: reservado[1],
            unidades: Number(reservado[2]),
          })
        : respuesta(409, "STOCK_RESERVADO", "No se puede archivar una variante con stock reservado")
    }
    case "P0034":
      return respuesta(422, "LIMITE_EXCEDIDO", "Superaste el máximo de opciones o variantes")
    case "P0035": {
      const duplicados = message.match(/^CODIGO_DUPLICADO:(.+)$/)
      if (!duplicados) return respuesta(409, "CODIGO_DUPLICADO", "Ya existe otro producto con ese código")
      const codigos = duplicados[1].split(",")
      return respuesta(409, "CODIGO_DUPLICADO", `Ya existe otro producto con el código ${codigos.join(", ")}`, { codigos })
    }
    case "23505":
      return respuesta(409, "CONFLICTO", "Dos variantes chocan en código o combinación. Revisá los datos y probá de nuevo")
    case "23514":
      return respuesta(400, "DATOS_INVALIDOS", "Los datos no cumplen las reglas del inventario")
    case "23503":
      return respuesta(404, "NO_ENCONTRADO", "Alguno de los productos o el proveedor ya no existe")
    case "40P01":
    case "40001":
      return respuesta(409, "REINTENTAR", "Otra persona estaba guardando al mismo tiempo. Probá de nuevo", { reintentable: true })
    case "P0010":
      return respuesta(400, "STOCK_INVALIDO", "No hay stock suficiente en el depósito elegido")
    case "P0011":
      return respuesta(400, "DEPOSITO_INVALIDO", "La organización no tiene depósito principal configurado")
  }

  return CODIGOS_MIGRACION.has(code) || isMissingColumnError(error) ? pendiente() : null
}

/** `mapearErrorRpc` as a Response, or null when the error is not one the RPC raises. */
export function respuestaDeError(error: unknown): NextResponse | null {
  const mapeado = mapearErrorRpc(error)
  return mapeado ? NextResponse.json(mapeado.body, { status: mapeado.status }) : null
}

/**
 * The 400 for a body the schema rejects: the FIRST issue's Spanish message, a machine code
 * and the field (`variantes.1.imagenUrl`; for an unknown key, the path plus the key itself).
 */
export function respuestaDeValidacion(error: z.ZodError): NextResponse {
  const [primero] = error.issues
  const ruta = primero?.path ?? []
  const campo =
    primero?.code === "unrecognized_keys"
      ? primero.keys.map((clave) => [...ruta, clave].join(".")).join(",")
      : ruta.join(".")
  return NextResponse.json(
    { error: primero?.message ?? "Los datos de las variantes no son válidos", code: "PAYLOAD_INVALIDO", campo },
    { status: 400 }
  )
}
