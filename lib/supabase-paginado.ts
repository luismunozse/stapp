/**
 * Lectura completa de una tabla, sin el corte silencioso de PostgREST.
 *
 * EL PROBLEMA
 *
 * Una consulta de Supabase sin `.range()` devuelve como máximo `max-rows`
 * filas (1000 por defecto) y no avisa: no hay error, no hay flag, llega un
 * array de 1000 y listo. Los reportes de Finanzas sumaban ese array y
 * mostraban el total como si fuera todo.
 *
 * Para un taller con 40 ventas por día eso son 1200 ventas en el mes: el
 * Estado de Resultados mostraba los ingresos de 1000. La ganancia salía más
 * chica y no había forma de darse cuenta. En la solapa Tendencia, que mira
 * entre 6 y 24 meses, el corte era sistemático.
 *
 * LA SOLUCIÓN
 *
 * Pedir de a páginas hasta que la base devuelva menos de una página entera.
 * El llamador pasa una FUNCIÓN que arma la consulta, no la consulta ya armada:
 * los query builders de supabase-js no se pueden volver a ejecutar una vez que
 * se los esperó, así que cada página necesita uno nuevo.
 *
 *     const { filas, truncado } = await traerTodo((desde, hasta) =>
 *       supabaseAdmin.from("ventas").select("*").eq(...).range(desde, hasta)
 *     )
 *
 * EL TOPE Y POR QUÉ SE DEVUELVE `truncado`
 *
 * Paginar sin límite cambia un reporte incompleto por una función que se
 * queda sin memoria o sin los 30 segundos de Vercel. Por eso hay un tope
 * (`maxFilas`) y, cuando se llega, `truncado` vuelve en true para que el
 * endpoint lo exponga y la pantalla avise que el número está incompleto.
 *
 * Un reporte que avisa es mejor que uno que miente. Y mejor que los dos es
 * que la suma la haga la base de datos: para períodos muy grandes el camino
 * correcto es una función SQL que devuelva los totales en una fila, no las
 * 50.000 filas para que las sume la aplicación. Esto es el piso, no el techo.
 */

/** Filas por pedido. Coincide con el `max-rows` por defecto de Supabase. */
export const TAMANO_PAGINA = 1000

/**
 * Tope de filas por fuente. Arriba de esto el reporte se devuelve marcado como
 * incompleto en vez de seguir trayendo hasta agotar la memoria de la función.
 *
 * 25.000 aguanta cómodo un año de un taller con mucho movimiento (unas 70
 * operaciones por día). El que lo supere necesita agregación en la base, no
 * un tope más alto.
 */
export const MAX_FILAS_POR_FUENTE = 25_000

export interface ResultadoPaginado<T> {
  filas: T[]
  /** true si se alcanzó `maxFilas` y quedaron filas sin traer. */
  truncado: boolean
}

type ConsultaPagina<T> = (
  desde: number,
  hasta: number
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/**
 * Ejecuta `construirConsulta` de a páginas hasta traer todo (o hasta `maxFilas`).
 *
 * Un error de la base corta y se propaga: un reporte a medias por un fallo de
 * red es peor que un error visible, porque se lee como un mes flojo de ventas.
 */
export async function traerTodo<T>(
  construirConsulta: ConsultaPagina<T>,
  opciones: { maxFilas?: number; tamanoPagina?: number } = {}
): Promise<ResultadoPaginado<T>> {
  const maxFilas = opciones.maxFilas ?? MAX_FILAS_POR_FUENTE
  const tamanoPagina = opciones.tamanoPagina ?? TAMANO_PAGINA

  const filas: T[] = []
  let offset = 0

  while (offset < maxFilas) {
    // No pedir más allá del tope: la última página se recorta para que el
    // total nunca pase `maxFilas`.
    const pedir = Math.min(tamanoPagina, maxFilas - offset)
    const { data, error } = await construirConsulta(offset, offset + pedir - 1)

    if (error) {
      throw new Error(`Error paginando consulta: ${error.message}`)
    }

    const pagina = data || []
    filas.push(...pagina)

    // Página incompleta = no hay más filas. Es la condición de corte normal.
    if (pagina.length < pedir) {
      return { filas, truncado: false }
    }

    offset += pagina.length
  }

  // Salimos por el tope. Puede que justo hubiera exactamente `maxFilas` filas
  // y no falte nada, pero no hay forma de saberlo sin otro pedido, y marcarlo
  // como incompleto es el error seguro: avisa de más, nunca de menos.
  return { filas, truncado: true }
}

/**
 * Tamaño de lote para filtros `.in("col", ids)`.
 *
 * PostgREST manda el filtro en la query string, así que una lista larga de ids
 * se convierte en una URL larga y el servidor la rechaza. Antes de paginar
 * esto no pasaba: las listas venían de consultas ya cortadas en 1000. Ahora
 * que traemos todo, una lista de ids puede ser de decenas de miles y hay que
 * partirla.
 *
 * 200 ids de cuid (~25 caracteres) son unos 5 KB de URL, bien dentro de
 * cualquier límite.
 */
export const TAMANO_LOTE_IN = 200

/**
 * Corre `consulta` una vez por cada lote de `ids` y junta los resultados.
 * Cada lote se pagina por separado, así que el resultado es completo aunque un
 * solo lote traiga más de 1000 filas.
 *
 * Con la lista vacía no consulta nada: `.in("col", [])` devolvería todo o
 * nada según el caso, y "nada" es la única respuesta correcta acá.
 */
export async function traerTodoPorLotes<T>(
  ids: string[],
  consulta: (lote: string[], desde: number, hasta: number) => PromiseLike<{
    data: T[] | null
    error: { message: string } | null
  }>,
  opciones: { maxFilas?: number; tamanoLote?: number } = {}
): Promise<ResultadoPaginado<T>> {
  const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE_IN
  const filas: T[] = []
  let truncado = false

  for (let i = 0; i < ids.length; i += tamanoLote) {
    const lote = ids.slice(i, i + tamanoLote)
    const res = await traerTodo<T>(
      (desde, hasta) => consulta(lote, desde, hasta),
      { maxFilas: opciones.maxFilas }
    )
    filas.push(...res.filas)
    if (res.truncado) truncado = true
  }

  return { filas, truncado }
}
