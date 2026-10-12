import { readdirSync, readFileSync } from "fs"
import { join } from "path"

// Migration text tests: there is no Postgres in CI, so these helpers let vitest pin
// what the SQL says. Files are resolved by suffix or marker, never by number,
// because migration numbers are assigned at merge time (a renumber must not break tests).

const ROOT = join(process.cwd(), "supabase/migrations")

function read(dir: string, pick: (name: string, text: string) => boolean, what: string): string {
  const base = join(ROOT, dir)
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue
    const text = readFileSync(join(base, entry.name), "utf8")
    if (pick(entry.name, text)) return text
  }
  throw new Error(`No file in supabase/migrations/${dir} matches ${what}`)
}

export const readBySuffix = (suffix: string) =>
  read("", (name) => name.endsWith(suffix), `suffix "${suffix}"`)

export const readByMarker = (dir: "rollback" | "verify", marker: string) =>
  read(dir, (_n, text) => text.includes(marker), `marker "${marker}"`)

/** Drops `--` and block comments so headers cannot satisfy or trip a regex. */
export const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "")

/** Comment-free SQL with all whitespace runs collapsed to one space. */
export const collapse = (sql: string) => stripComments(sql).replace(/\s+/g, " ").trim()
