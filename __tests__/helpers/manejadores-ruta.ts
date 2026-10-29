import ts from "typescript"

// Static reading of Next route files for the sweeps: which HTTP handlers a file exports, whatever the
// export form, and the syntax tree of each. Shared by the per-route-family sweeps under __tests__/lib.

export const METODOS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
export const ESCRITURAS = ["insert", "update", "upsert", "delete", "rpc"]

export interface Manejador {
  metodo: string
  /** The syntax node of the handler; null when it cannot be seen (re-exports). */
  nodo: ts.Node | null
  /** Why the handler cannot be checked, if it cannot. */
  opaco?: string
}

const tieneExport = (st: ts.Node) =>
  ts.canHaveModifiers(st) && !!ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

/** The exported HTTP handlers of a route file, in whatever form they are exported. */
export function manejadores(src: string): Manejador[] {
  const sf = ts.createSourceFile("route.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const locales = new Map<string, ts.Node>()
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) locales.set(st.name.text, st)
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) locales.set(d.name.text, d.initializer)
      }
    }
  }

  const salida: Manejador[] = []
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && tieneExport(st) && st.name && METODOS.includes(st.name.text)) {
      salida.push({ metodo: st.name.text, nodo: st })
    } else if (ts.isVariableStatement(st) && tieneExport(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && METODOS.includes(d.name.text)) {
          salida.push({ metodo: d.name.text, nodo: d.initializer ?? null })
        } else if (ts.isObjectBindingPattern(d.name)) {
          for (const e of d.name.elements) {
            if (ts.isIdentifier(e.name) && METODOS.includes(e.name.text)) {
              salida.push({ metodo: e.name.text, nodo: null, opaco: "exported by destructuring" })
            }
          }
        }
      }
    } else if (ts.isExportDeclaration(st)) {
      if (!st.exportClause) {
        salida.push({ metodo: "*", nodo: null, opaco: "`export *` re-exports names this sweep cannot see" })
      } else if (ts.isNamedExports(st.exportClause)) {
        for (const e of st.exportClause.elements) {
          if (!METODOS.includes(e.name.text)) continue
          const local = (e.propertyName ?? e.name).text
          if (st.moduleSpecifier) salida.push({ metodo: e.name.text, nodo: null, opaco: "re-exported from another module" })
          else if (locales.has(local)) salida.push({ metodo: e.name.text, nodo: locales.get(local)! })
          else salida.push({ metodo: e.name.text, nodo: null, opaco: `exports \`${local}\`, which is not defined here` })
        }
      }
    }
  }
  return salida
}

/** Every node under `raiz`, in source order. */
export function nodos(raiz: ts.Node): ts.Node[] {
  const lista: ts.Node[] = []
  const visitar = (n: ts.Node) => {
    lista.push(n)
    ts.forEachChild(n, visitar)
  }
  ts.forEachChild(raiz, visitar)
  return lista
}

