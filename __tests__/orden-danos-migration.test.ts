// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Las migraciones se aplican a mano y no hay Postgres en CI: este test fija por
// texto las reglas del diagrama de daños que vitest no puede ejecutar.
const SQL = readFileSync(join(process.cwd(), "supabase/migrations/408_orden_danos.sql"), "utf8")

describe("migración 408: orden_danos", () => {
  it("tabla con CHECKs de tipo, momento, vista, rango y nota", () => {
    expect(SQL).toContain("CHECK (tipo IN ('rayon', 'golpe', 'rotura', 'faltante', 'humedad', 'otro'))")
    expect(SQL).toContain("CHECK (momento IN ('recepcion', 'diagnostico'))")
    expect(SQL).toContain("CHECK (vista IN ('frente', 'dorso', 'lateral'))")
    expect(SQL).toContain("CHECK (x >= 0 AND x <= 1)")
    expect(SQL).toContain("CHECK (y >= 0 AND y <= 1)")
    expect(SQL).toContain("CHECK (char_length(nota) <= 200)")
    expect(SQL).toContain("UNIQUE (orden_id, numero)")
  })

  it("RLS: select por organización y all para service_role, sin escritura para authenticated", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.orden_danos ENABLE ROW LEVEL SECURITY/)
    expect(SQL).toMatch(/FOR SELECT TO authenticated\s+USING \(organization_id = public\.get_current_organization_id\(\)\)/)
    expect(SQL).toMatch(/FOR ALL TO service_role/)
    expect(SQL).toContain("REVOKE ALL ON public.orden_danos FROM PUBLIC, anon, authenticated;")
    expect(SQL).toContain("GRANT SELECT ON public.orden_danos TO authenticated;")
  })

  it("columnas de configuración con default false", () => {
    expect(SQL).toContain("recepcion_sin_danos BOOLEAN NOT NULL DEFAULT false")
    expect(SQL).toContain("danos_recepcion_obligatorio BOOLEAN NOT NULL DEFAULT false")
  })

  it("los pins de recepción solo entran por el RPC", () => {
    expect(SQL).toContain("current_setting('stapp.danos_recepcion', true)")
    expect(SQL).toContain("set_config('stapp.danos_recepcion', 'on', true)")
  })

  it("todos los códigos de error del contrato", () => {
    for (const code of [
      "DANOS_RECEPCION_YA_REGISTRADA",
      "DANOS_RECEPCION_FUERA_DE_VENTANA",
      "DANOS_ORDEN_CERRADA",
      "DANOS_RECEPCION_INMUTABLE",
      "DANOS_DIAGNOSTICO_FUERA_DE_VENTANA",
      "DANOS_SIN_DANOS_CON_PINS",
      "DANOS_LIMITE",
    ]) {
      expect(SQL).toContain(`'${code}'`)
    }
  })

  it("RPC SECURITY DEFINER, search_path fijo y solo service_role", () => {
    expect(SQL).toMatch(/SECURITY DEFINER\s+SET search_path = public/)
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION public\.registrar_estado_fisico_recepcion\([^)]*\) FROM PUBLIC, anon, authenticated;/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.registrar_estado_fisico_recepcion\([^)]*\) TO service_role;/)
  })

  it("serializa por orden con FOR UPDATE y asigna numero en el trigger", () => {
    expect(SQL).toMatch(/FOR UPDATE/)
    expect(SQL).toMatch(/NEW\.numero := COALESCE\(\(SELECT max\(numero\)/)
  })

  it("el borrado en cascada de la orden pasa por el trigger DELETE", () => {
    expect(SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.ordenes_servicio WHERE id = OLD\.orden_id\)/)
  })

  it("el UPDATE solo se permite para el SET NULL de created_by; la cascada de organización también pasa", () => {
    expect(SQL).toContain("(to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by')")
    expect(SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.organizations WHERE id = OLD\.organization_id\)/)
  })
})
