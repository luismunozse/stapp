// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Las migraciones se aplican a mano y no hay Postgres en CI: este test fija por
// texto que la recepción múltiple registra el estado físico dentro de su misma
// transacción y que no cambia la firma ni los permisos de la función.
const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const SQL = leer("supabase/migrations/410_recepcion_multiple_estado_fisico.sql")
const ROLLBACK = leer("supabase/migrations/rollback/410_rollback.sql")
const PROBES = leer("supabase/migrations/verify/410_probes.sql")

const FIRMA =
  "public.crear_recepcion_multiple(p_organization_id text, p_sucursal_id text, p_cliente_id text, p_equipos jsonb, p_firma_cliente text, p_firma_mime text, p_terminos boolean, p_recibido_por text, p_created_by text, p_telefono_contacto text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text)"

describe("migración 410: estado físico en crear_recepcion_multiple", () => {
  it("reemplaza la función con la misma firma (sin parámetros nuevos)", () => {
    expect(SQL).toContain(`CREATE OR REPLACE FUNCTION ${FIRMA}`)
    expect(ROLLBACK).toContain(`CREATE OR REPLACE FUNCTION ${FIRMA}`)
  })

  it("sigue SECURITY INVOKER y no toca los grants", () => {
    expect(SQL).not.toMatch(/SECURITY DEFINER/)
    expect(SQL).not.toMatch(/\bGRANT\b|\bREVOKE\b/)
    expect(ROLLBACK).not.toMatch(/\bGRANT\b|\bREVOKE\b/)
  })

  it("registra el estado físico de cada orden con el RPC de 408, en la misma transacción", () => {
    expect(SQL).toMatch(
      /PERFORM public\.registrar_estado_fisico_recepcion\(\s*v_orden_id,\s*p_organization_id,\s*v_danos,\s*v_sin_danos,\s*p_created_by\s*\)/,
    )
    // Sin EXCEPTION: un fallo del estado físico aborta la recepción entera.
    expect(SQL).not.toMatch(/\bEXCEPTION\s+WHEN\b/)
    // Solo cuando el equipo trae pins o "sin daños".
    expect(SQL).toMatch(/IF jsonb_array_length\(v_danos\) > 0 OR v_sin_danos THEN/)
  })

  it("lee danos y recepcionSinDanos de cada equipo de forma tolerante", () => {
    expect(SQL).toContain("v_equipo->'danos'")
    expect(SQL).toContain("v_equipo->>'recepcionSinDanos'")
  })

  it("el rollback vuelve a la definición viva, sin estado físico", () => {
    expect(ROLLBACK).not.toContain("registrar_estado_fisico_recepcion")
    expect(ROLLBACK).toContain("v_prefijo := COALESCE(v_prefijo, 'ORD');")
  })

  it("los probes corren en una transacción que siempre termina en ROLLBACK", () => {
    expect(PROBES).toMatch(/^BEGIN;/m)
    expect(PROBES.trimEnd().endsWith("ROLLBACK;")).toBe(true)
  })

  it("el ensayo del rollback en los probes es el archivo de rollback, tal cual", () => {
    const inline = PROBES.split("-- ROLLBACK:BEGIN\n")[1]?.split("-- ROLLBACK:END")[0] ?? ""
    expect(inline.trim()).toBe(ROLLBACK.trim())
  })

  it("los probes cubren pins, sin daños, equipo sin estado físico y el fallo atómico", () => {
    expect(PROBES).toContain("'P0001:DANOS_SIN_DANOS_CON_PINS'")
    expect(PROBES).toContain("'23514'")
    expect(PROBES).toContain("failed receptions left no reception, order or pin behind")
    expect(PROBES).toContain("reception without estado físico")
  })
})
