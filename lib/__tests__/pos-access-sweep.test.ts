import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Guard arquitectónico, gemelo de inventario-access-sweep: ningún endpoint de
// ventas debe seguir usando requireAdminOrVendedor — el acceso al POS va por
// requirePosAccess (ADMIN y VENDEDOR siempre, TECNICO según flag de org). Un
// endpoint nuevo que use el guard viejo deja al técnico habilitado afuera de
// una parte del POS, y esa mitad-de-permiso es peor que no tener el permiso.
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

describe('endpoints de ventas', () => {
  const files = routeFiles(join(process.cwd(), 'app', 'api', 'ventas'))

  it('existen endpoints que auditar', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it('ninguno usa requireAdminOrVendedor — todos van por requirePosAccess', () => {
    const ofensores: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const block of topLevelBlocks(src)) {
        if (!block.isHandler) continue
        if (/\brequireAdminOrVendedor\b/.test(block.body)) {
          ofensores.push(`${file.replace(process.cwd(), '')} :: ${block.name}`)
        }
      }
    }
    expect(ofensores).toEqual([])
  })

  it('ninguno decide el alcance de lectura preguntando solo por VENDEDOR', () => {
    // `role === "VENDEDOR"` como sinónimo de "no es admin, ve solo lo suyo" se
    // rompe apenas entra un tercer rol al POS: el técnico habilitado pasaba a
    // ver las ventas de TODA la sucursal. El alcance se pregunta por lo que
    // es —no ser ADMIN—, no enumerando roles.
    const ofensores: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const block of topLevelBlocks(src)) {
        if (!block.isHandler) continue
        if (/role === "VENDEDOR"/.test(block.body)) {
          ofensores.push(`${file.replace(process.cwd(), '')} :: ${block.name}`)
        }
      }
    }
    expect(ofensores).toEqual([])
  })
})
