import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

// Static scans of the source tree (sweeps). Tests and node_modules are skipped.

export interface Fuente {
  rel: string
  src: string
}

function recorrer(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) recorrer(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** Every .ts/.tsx source under `raices`, plus the loose `archivos`, with paths relative to the repo root. */
export function leerFuentes(raices: string[], archivos: string[] = []): Fuente[] {
  const root = process.cwd()
  return [
    ...raices.flatMap((d) => recorrer(join(root, d))),
    ...archivos.map((f) => join(root, f)).filter((f) => existsSync(f)),
  ].map((f) => ({ rel: relative(root, f).split(sep).join("/"), src: readFileSync(f, "utf8") }))
}

/** Code without comments, so prose that mentions a call or a name is not mistaken for code. */
export function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}
