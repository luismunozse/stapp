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
  it('formatInventario(x, true) solo aparece detrás de requireInventarioAccess', () => {
    const optInLiteral = /formatInventario\([^)]*,\s*true\s*\)/
    const ofensores = files.filter((f) => {
      const src = readFileSync(f, 'utf8')
      return optInLiteral.test(src) && !/\brequireInventarioAccess\b/.test(src)
    })
    expect(ofensores).toEqual([])
  })
})
