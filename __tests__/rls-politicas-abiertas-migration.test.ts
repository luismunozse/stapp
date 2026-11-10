// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "fs"
import { join } from "path"
import { collapse, readBySuffix } from "./helpers/sql-text"

// La anon key es pública: una política sin `TO <rol>` aplica a PUBLIC (incluye
// anon). 384 cerró las que habían quedado abiertas; esto evita que vuelvan.
const ROOT = join(process.cwd(), "supabase/migrations")
const ULTIMA_REVISADA = 384

const migracionesNuevas = () =>
  readdirSync(ROOT)
    .filter((n) => n.endsWith(".sql") && Number.parseInt(n, 10) > ULTIMA_REVISADA)
    .map((n) => ({ nombre: n, sql: collapse(readFileSync(join(ROOT, n), "utf8")) }))

const politicas = (sql: string) => sql.match(/CREATE POLICY [^;]*;/gi) ?? []

describe("políticas RLS en migraciones posteriores a 384", () => {
  it("toda política declara el rol con TO", () => {
    const sinRol = migracionesNuevas().flatMap(({ nombre, sql }) =>
      politicas(sql).filter((p) => !/\sTO\s/i.test(p)).map((p) => `${nombre}: ${p}`)
    )
    expect(sinRol).toEqual([])
  })

  it("ninguna política USING (true) es para PUBLIC, anon o authenticated", () => {
    const abiertas = migracionesNuevas().flatMap(({ nombre, sql }) =>
      politicas(sql)
        .filter((p) => /USING \(\s*true\s*\)/i.test(p))
        .filter((p) => /\sTO\s+(public|anon|authenticated)\b/i.test(p))
        .map((p) => `${nombre}: ${p}`)
    )
    expect(abiertas).toEqual([])
  })
})

describe("migración 384 (cerrar tablas abiertas)", () => {
  const sql = collapse(readBySuffix("_rls_cerrar_tablas_abiertas.sql"))

  it.each([
    "sucursales",
    "sucursal_whatsapp_config",
    "asistente_conversaciones",
    "asistente_mensajes",
    "foto_borrador",
    "foto_borrador_item",
    "support_tickets",
    "support_ticket_messages",
    "support_ticket_attachments",
    "push_tokens",
    "broadcasts",
    "plans_audit",
    "chatbot_conversaciones",
    "chatbot_mensajes",
    "tipos_dispositivo",
    "notas_credito_counter",
    "audit_alert_config",
  ])("cierra %s", (tabla) => {
    expect(sql).toContain(`'${tabla}'`)
  })

  it("no toca user_notifications (la campanita Realtime usa la anon key)", () => {
    expect(sql).not.toContain("user_notifications")
  })

  it("habilita RLS y revoca a anon y authenticated", () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/)
  })

  it("no abre su propia transacción (db-run.mjs la envuelve)", () => {
    expect(sql).not.toMatch(/^\s*BEGIN\s*;/im)
  })
})
