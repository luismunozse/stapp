import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * Utilidades compartidas por los guards arquitectónicos de acceso
 * (`*-access-sweep.test.ts`).
 *
 * Los tres sweeps anteriores —pos, inventario, caja— copiaron este parser cada
 * uno por su lado. Se extrae acá para que los nuevos no sigan multiplicándolo;
 * migrar los tres viejos es una limpieza aparte, no de este cambio.
 *
 * NO termina en `.test.ts` a propósito: `vitest.config.ts` colecta
 * `**\/*.{test,spec}.{ts,tsx}`, así que un archivo de utilidades con ese sufijo
 * se ejecutaría como suite vacía y fallaría por "no test suite found".
 */

export function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return name === 'route.ts' ? [full] : []
  })
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export interface TopLevelBlock {
  name: string
  isHandler: boolean
  body: string
}

/**
 * Parte el archivo en bloques top-level para atribuir cada ocurrencia a SU
 * handler: un archivo puede mezclar un GET y un POST con guards distintos, y
 * buscar en todo el archivo daría verde igual. Eso es exactamente lo que
 * escondía las fugas: el POST ya pedía requireAdmin y el GET había quedado en
 * requireAuth, en el mismo route.ts.
 */
export function topLevelBlocks(src: string): TopLevelBlock[] {
  const declaration = /^(export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/gm
  const marks: { index: number; exported: boolean; name: string }[] = []
  for (const m of src.matchAll(declaration)) {
    marks.push({ index: m.index!, exported: !!m[1], name: m[2] || m[3] })
  }
  return marks.map((mark, i) => ({
    name: mark.name,
    isHandler: mark.exported && HTTP_METHODS.has(mark.name),
    body: src.slice(mark.index, i + 1 < marks.length ? marks[i + 1].index : src.length),
  }))
}

/** Handlers HTTP exportados de un namespace, con su ruta relativa normalizada. */
export function handlersDe(dirNamespace: string): { id: string; metodo: string; body: string }[] {
  return routeFiles(dirNamespace).flatMap((file) => {
    const id = relative(dirNamespace, file).split(sep).join('/')
    return topLevelBlocks(readFileSync(file, 'utf8'))
      .filter((b) => b.isHandler)
      .map((b) => ({ id, metodo: b.name, body: b.body }))
  })
}
