import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

// Guard arquitectónico, gemelo de pos-access-sweep e inventario-access-sweep.
//
// La operativa de caja —abrir el turno, cerrarlo con arqueo, cargar
// movimientos manuales— va por requireCajaAccess (ADMIN siempre, VENDEDOR
// según el flag de la org). Un endpoint nuevo que se quede en requireAdmin
// deja al vendedor habilitado afuera de una parte de la caja, y esa
// mitad-de-permiso es peor que no tener el permiso: el turno se abre pero no
// se cierra.
//
// El corte NO es "todo el namespace": el histórico financiero sigue siendo del
// ADMIN. Por eso la lista de abajo es explícita y el barrido la respeta —
// barrer por namespace no alcanza para decidir quién escribe qué.
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return name === 'route.ts' ? [full] : []
  })
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

interface TopLevelBlock {
  name: string
  isHandler: boolean
  body: string
}

// Parte el archivo en bloques top-level para atribuir cada ocurrencia a SU
// handler: un archivo puede mezclar un GET y un DELETE con guards distintos, y
// buscar en todo el archivo daría verde igual.
function topLevelBlocks(src: string): TopLevelBlock[] {
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

const CAJA_DIR = join(process.cwd(), 'app', 'api', 'caja')

/** Ruta relativa al namespace, con "/" en cualquier plataforma. */
function id(file: string): string {
  return relative(CAJA_DIR, file).split(sep).join('/')
}

// El histórico financiero de la organización no es del turno de nadie: el
// export CSV lo sigue pidiendo el ADMIN. Está acá, con nombre y motivo, para
// que abrirlo sea una decisión y no un descuido.
const RESERVADOS_AL_ADMIN = new Set(['export/route.ts'])

// Handlers que un VENDEDOR habilitado tiene que poder ejecutar. La lista es
// explícita a propósito: si mañana aparece un endpoint de operativa nuevo,
// agregarlo acá es parte de escribirlo.
const OPERATIVA_DE_TURNO: [string, string][] = [
  ['sesiones/route.ts', 'POST'],
  ['sesiones/[id]/cerrar/route.ts', 'POST'],
  ['movimientos/route.ts', 'GET'],
  ['movimientos/route.ts', 'POST'],
  ['movimientos/[id]/route.ts', 'DELETE'],
  ['movimientos/upload-comprobante/route.ts', 'POST'],
]

describe('endpoints de caja', () => {
  const files = routeFiles(CAJA_DIR)

  it('existen endpoints que auditar', () => {
    expect(files.length).toBeGreaterThanOrEqual(6)
  })

  it('la operativa del turno va por requireCajaAccess', () => {
    const faltantes: string[] = []
    for (const [ruta, metodo] of OPERATIVA_DE_TURNO) {
      const file = files.find((f) => id(f) === ruta)
      if (!file) {
        faltantes.push(`${ruta} :: archivo ausente`)
        continue
      }
      const block = topLevelBlocks(readFileSync(file, 'utf8')).find(
        (b) => b.isHandler && b.name === metodo,
      )
      if (!block) {
        faltantes.push(`${ruta} :: ${metodo} ausente`)
        continue
      }
      if (!/\brequireCajaAccess\b/.test(block.body)) {
        faltantes.push(`${ruta} :: ${metodo}`)
      }
    }
    expect(faltantes).toEqual([])
  })

  it('ninguno de esos handlers sigue pidiendo requireAdmin', () => {
    const ofensores: string[] = []
    for (const [ruta, metodo] of OPERATIVA_DE_TURNO) {
      const file = files.find((f) => id(f) === ruta)
      if (!file) continue
      const block = topLevelBlocks(readFileSync(file, 'utf8')).find(
        (b) => b.isHandler && b.name === metodo,
      )
      if (block && /\brequireAdmin\b/.test(block.body)) {
        ofensores.push(`${ruta} :: ${metodo}`)
      }
    }
    expect(ofensores).toEqual([])
  })

  it('el histórico financiero sigue siendo del ADMIN', () => {
    const abiertos: string[] = []
    for (const file of files) {
      if (!RESERVADOS_AL_ADMIN.has(id(file))) continue
      for (const block of topLevelBlocks(readFileSync(file, 'utf8'))) {
        if (!block.isHandler) continue
        if (!/\brequireAdmin\b/.test(block.body)) {
          abiertos.push(`${id(file)} :: ${block.name}`)
        }
      }
    }
    expect(abiertos).toEqual([])
  })
})
