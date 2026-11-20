import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// La 420 se probó contra la base en una transacción revertida (alta, cambio de
// cantidad y baja de repuesto; servicio por RPC; monto editado a mano;
// "Aplicar al total"). Este test cuida las invariantes del texto.
const dir = join(__dirname, "..", "supabase", "migrations")
const sinComentarios = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
const codigo = sinComentarios(readFileSync(join(dir, "420_repuestos_suman_al_total.sql"), "utf8"))
const rollback = sinComentarios(readFileSync(join(dir, "rollback", "420_rollback.sql"), "utf8"))

describe("migración 420: los repuestos suman al monto de la orden", () => {
  it("no maneja su propia transacción (db-run la envuelve)", () => {
    expect(codigo).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("la suma incluye repuestos a precio de venta, con el costo como respaldo", () => {
    expect(codigo).toMatch(
      /FUNCTION suma_lineas_orden[\s\S]*?servicios_orden[\s\S]*?COALESCE\(precio_venta_unitario, precio_unitario, 0\)[\s\S]*?repuestos_orden/,
    )
  })

  it("mantiene las firmas de los RPCs de servicios (si no, crea sobrecargas)", () => {
    expect(codigo).toMatch(
      /FUNCTION agregar_servicio_orden\(\s*p_orden_id TEXT,\s*p_organization_id TEXT,\s*p_servicio_id TEXT,\s*p_nombre TEXT,\s*p_cantidad INTEGER,\s*p_precio_unitario NUMERIC\s*\)/,
    )
    expect(codigo).toMatch(
      /FUNCTION eliminar_servicio_orden\(\s*p_orden_id TEXT,\s*p_organization_id TEXT,\s*p_servicio_orden_id TEXT\s*\)/,
    )
    expect(codigo).toMatch(/FUNCTION aplicar_monto_servicios_orden\(\s*p_orden_id TEXT,\s*p_organization_id TEXT\s*\)/)
  })

  it("los RPCs de servicios siguen filtrando por organización", () => {
    const agregar = codigo.slice(codigo.indexOf("FUNCTION agregar_servicio_orden"), codigo.indexOf("FUNCTION eliminar_servicio_orden"))
    expect(agregar).toMatch(/organization_id = p_organization_id\s+FOR UPDATE/)
  })

  it("la regla no toca el monto si ya hay cobros", () => {
    expect(codigo).toMatch(/COALESCE\(v_total_cobrado, 0\) <= 0/)
  })

  it("el trigger de repuestos cubre alta, baja y cambios de importe", () => {
    expect(codigo).toMatch(
      /AFTER INSERT OR DELETE OR UPDATE OF cantidad, precio_unitario, precio_venta_unitario, orden_id\s+ON repuestos_orden\s+FOR EACH ROW/,
    )
  })

  it("el rollback saca el trigger y las funciones nuevas y restaura la 304", () => {
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS repuestos_orden_sincroniza_monto/)
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS sincronizar_monto_lineas_orden/)
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS suma_lineas_orden/)
    expect(rollback).not.toMatch(/suma_lineas_orden\(p_orden_id\)/)
    expect(rollback).toMatch(/CREATE OR REPLACE FUNCTION aplicar_monto_servicios_orden/)
  })
})
