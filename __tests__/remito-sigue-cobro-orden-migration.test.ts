import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// La 417 se probó contra la base con un dry-run (backfill, cobro nuevo y
// anulación). Este test cuida las invariantes del texto que, si se pierden,
// rompen plata o meten un bucle de triggers.
const sql = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "417_remito_sigue_cobro_orden.sql"),
  "utf8",
)
const codigo = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")

describe("migración 417: el remito sigue lo cobrado en la orden", () => {
  it("no maneja su propia transacción (db-run la envuelve)", () => {
    expect(codigo).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("el trigger de la orden solo dispara si cambia lo cobrado (corta la recursión con la 345)", () => {
    expect(codigo).toMatch(
      /AFTER UPDATE OF total_cobrado, estado_cobro ON ordenes_servicio[\s\S]*?WHEN \(OLD\.total_cobrado IS DISTINCT FROM NEW\.total_cobrado\s+OR OLD\.estado_cobro IS DISTINCT FROM NEW\.estado_cobro\)/,
    )
  })

  it("solo escribe el remito si algo cambia", () => {
    expect(codigo).toMatch(/IS DISTINCT FROM n\.abonado[\s\S]*?IS DISTINCT FROM n\.estado/)
  })

  it("no toca remitos anulados ni remitos con total 0", () => {
    expect(codigo).toMatch(/estado_pago::text <> 'ANULADA'/)
    expect(codigo).toMatch(/f\.total > 0/)
  })

  it("orden COBRADO = remito pagado completo; si no, nunca más que el total", () => {
    expect(codigo).toMatch(/WHEN o\.estado_cobro = 'COBRADO' THEN f\.total/)
    expect(codigo).toMatch(/LEAST\(f\.total,/)
  })

  it("no mueve plata", () => {
    expect(codigo).not.toMatch(/INSERT INTO (cobros_orden|pagos_parciales|movimientos_caja|cuenta_corriente)/i)
  })
})
