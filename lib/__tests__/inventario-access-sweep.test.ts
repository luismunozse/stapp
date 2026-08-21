import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Guard arquitectónico: ningún endpoint de inventario debe usar requireAdmin
// directo — el acceso va por requireInventarioAccess (ADMIN siempre,
// VENDEDOR según flag de org). Si agregás un endpoint nuevo, usá el helper.
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
  /** Exported con nombre de método HTTP: es un handler de Next. */
  isHandler: boolean
  body: string
}

// Parte el archivo en bloques top-level (declaraciones que arrancan en columna
// 0). Alcanza para atribuir cada ocurrencia a SU handler: un archivo puede
// mezclar un GET con requireAuth() y un PUT con requireInventarioAccess(), y
// buscar el guard en todo el archivo daría verde igual.
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

describe('endpoints de inventario', () => {
  const files = routeFiles(join(process.cwd(), 'app', 'api', 'inventario'))

  it('existen endpoints que auditar', () => {
    expect(files.length).toBeGreaterThanOrEqual(30)
  })

  it('ninguno usa requireAdmin — todos van por requireInventarioAccess', () => {
    // Word boundary: no debe confundir requireAdmin con requireAdminOrVendedor
    // (otro guard, legítimo y fuera de alcance de este barrido).
    const requireAdminUsage = /\brequireAdmin\b/
    const ofensores = files.filter((f) => requireAdminUsage.test(readFileSync(f, 'utf8')))
    expect(ofensores).toEqual([])
  })

  // formatInventario emite precio_compra solo con includeCost en true. Pasarlo
  // como literal es un opt-in incondicional: vale únicamente donde el guard de
  // la ruta ya resolvió el permiso. Si el costo depende del rol, la ruta tiene
  // que pasar el resultado de hasInventarioAccess, no un true fijo.
  //
  // El chequeo se hace POR HANDLER, no por archivo: buscar el guard en todo el
  // texto pasa en cuanto cualquier handler lo menciona, y hay archivos que
  // mezclan un GET con requireAuth() y un PUT con requireInventarioAccess()
  // (app/api/inventario/[id]/route.ts). Meter el opt-in en ese GET shippearía
  // en verde.
  it('formatInventario(x, true) solo aparece dentro de un handler con requireInventarioAccess', () => {
    const optInLiteral = /formatInventario\([^)]*,\s*true\s*\)/g
    const ofensores: string[] = []

    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const total = (src.match(optInLiteral) || []).length
      if (total === 0) continue

      let atribuidas = 0
      for (const block of topLevelBlocks(src)) {
        const hits = (block.body.match(optInLiteral) || []).length
        if (hits === 0) continue
        atribuidas += hits
        if (!block.isHandler) {
          ofensores.push(`${f} -> ${block.name} (no es un handler exportado)`)
        } else if (!/\brequireInventarioAccess\b/.test(block.body)) {
          ofensores.push(`${f} -> ${block.name} (sin requireInventarioAccess)`)
        }
      }

      // Una ocurrencia que no cae en ningún bloque top-level (import, JSX
      // suelto, lo que sea) no se puede atribuir a un guard: es ofensora.
      if (atribuidas !== total) {
        ofensores.push(`${f} -> ${total - atribuidas} ocurrencia(s) fuera de todo bloque top-level`)
      }
    }

    expect(ofensores).toEqual([])
  })
})
