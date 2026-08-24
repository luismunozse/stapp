-- =============================================================================
-- Verificación de la migración 309 — fin del doble conteo de deuda de fiado
-- en get_deuda_cliente_sucursal.
--
-- CÓMO CORRERLO (ver verify/README.md):
--   - SQL editor de Supabase Studio, DESPUÉS de aplicar 309.
--   - SIN RLS: las rutas de la app usan supabaseAdmin (service_role), así que
--     correr sin RLS es fiel a producción.
--
-- A diferencia de docs/deuda-fiado-doble-conteo-verificacion.sql (que audita
-- datos REALES de producción, de solo lectura, para la descripción del PR),
-- este archivo arma su propia organización/cliente/órdenes sintéticas dentro
-- de BEGIN/ROLLBACK: nada de esto persiste. Es la única forma de forzar,
-- reproduciblemente, los cinco escenarios que 309 tiene que distinguir.
--
-- Los cinco escenarios (uno por cliente sintético):
--   1. Orden entregada a fiado, sin ningún cobro: hoy suma en deuda_fiado
--      (vía el CARGO) Y en deuda_ordenes (vía costo_final-cobrado). Con 309,
--      solo debe sumar una vez.
--   2. Orden con un cobro parcial ANTES de entregar, y el resto a fiado al
--      entregar: mismo bug, con estado_cobro='PARCIAL' en vez de 'PENDIENTE'.
--   3. Orden con saldo pendiente y SIN CARGO — el caso de degradación:
--      cargar_deuda_cuenta_corriente loguea sus errores y NO aborta la
--      entrega (entregar/route.ts:199-202), así que estas órdenes existen en
--      producción. Tienen que seguir sumando en deuda_ordenes: no es un caso
--      a "arreglar", es el comportamiento correcto que 309 no debe romper.
--   4. Orden cuyo CARGO fue revertido — simulado con una DEVOLUCION del mismo
--      monto sobre la misma referencia, porque la columna de reversión
--      todavía no existe (la introduce PR2). El CARGO original SIGUE
--      existiendo: la regla de 309 es "una vez que la deuda migró a cuenta
--      corriente, esa orden queda excluida de deuda_ordenes pase lo que
--      pase" — no "excluida mientras el CARGO no se revierta". Si alguien
--      agregara una condición `revertido_at IS NULL` a la exclusión, este
--      probe es el que lo detecta: la orden reaparecería en deuda_ordenes
--      con el saldo pendiente original, aunque el fiado ya esté en cero.
--   5. Orden EN_REPARACION (no cobrable todavía) con costo_final ya cargado,
--      estado_cobro='PENDIENTE', total_cobrado=0 y SIN CARGO. Este es el caso
--      que el controller original (267 + NOT EXISTS, sin el filtro de
--      estado de 273) no distinguía: sin `o.estado IN ('REPARADO',
--      'ENTREGADO')`, esta orden sumaría como deuda pese a que el equipo
--      todavía está en el banco, sin entregar ni cobrar. Si alguien borrara
--      el filtro de estado heredado de 273, este probe pasaría a dar 700.00
--      en vez de 0.00.
--
-- Los resultados se acumulan en _r y salen en UN solo SELECT al final, porque
-- el editor muestra únicamente el último statement que devuelve filas.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- ---------------------------------------------------------------------------
-- Fixture: una organización, una sucursal y cinco clientes sintéticos, uno
-- por escenario. IDs explícitos (en vez de generate_cuid()) para poder
-- referenciarlos sin variables de sesión.
-- ---------------------------------------------------------------------------
INSERT INTO organizations (id, nombre, slug, activo, rubro)
VALUES ('probe-309-org', 'Probe 309', 'probe-309-' || substr(md5(random()::text), 1, 8), TRUE, 'electronica');

INSERT INTO sucursales (id, organization_id, nombre, principal, activo)
VALUES ('probe-309-suc', 'probe-309-org', 'Casa Central', TRUE, TRUE);

INSERT INTO clientes (id, nombre, telefono, organization_id) VALUES
  ('probe-309-cli-1', 'Cliente fiado sin cobro',  '309-0001', 'probe-309-org'),
  ('probe-309-cli-2', 'Cliente cobro parcial',    '309-0002', 'probe-309-org'),
  ('probe-309-cli-3', 'Cliente sin CARGO (degradacion)', '309-0003', 'probe-309-org'),
  ('probe-309-cli-4', 'Cliente CARGO revertido',  '309-0004', 'probe-309-org'),
  ('probe-309-cli-5', 'Cliente en reparacion (no cobrable)', '309-0005', 'probe-309-org');

-- Órdenes: las 4 primeras ENTREGADO, todas con costo_final fijado en la
-- entrega — el estado real en el que ocurre el bug de doble conteo (ver mig
-- 309, comentario FIX). La 5ta queda EN_REPARACION a propósito: cobra el
-- filtro de estado heredado de 273 (`o.estado IN ('REPARADO','ENTREGADO')`),
-- que el controller original no traía.
INSERT INTO ordenes_servicio (
  id, numero_orden, cliente_id, organization_id, sucursal_id,
  dispositivo, tipo_dispositivo, problema_reportado, estado,
  costo_final, descuento_cobro, total_cobrado, estado_cobro
) VALUES
  -- (1) Fiado sin cobro: pendiente = 1000, CARGO = 1000.
  ('probe-309-orden-1', 1, 'probe-309-cli-1', 'probe-309-org', 'probe-309-suc',
   'Celular', 'CELULAR', 'Pantalla rota', 'ENTREGADO',
   1000.00, 0, 0, 'PENDIENTE'),
  -- (2) Cobro parcial (400) + fiado por el resto: pendiente = 600, CARGO = 600.
  ('probe-309-orden-2', 2, 'probe-309-cli-2', 'probe-309-org', 'probe-309-suc',
   'Celular', 'CELULAR', 'Bateria', 'ENTREGADO',
   1000.00, 0, 400.00, 'PARCIAL'),
  -- (3) Pendiente = 800, SIN CARGO (cargar_deuda_cuenta_corriente fallo y no aborto).
  ('probe-309-orden-3', 3, 'probe-309-cli-3', 'probe-309-org', 'probe-309-suc',
   'Celular', 'CELULAR', 'Camara', 'ENTREGADO',
   800.00, 0, 0, 'PENDIENTE'),
  -- (4) Pendiente = 500, CARGO = 500 luego revertido con una DEVOLUCION de 500.
  ('probe-309-orden-4', 4, 'probe-309-cli-4', 'probe-309-org', 'probe-309-suc',
   'Celular', 'CELULAR', 'Carga', 'ENTREGADO',
   500.00, 0, 0, 'PENDIENTE'),
  -- (5) EN_REPARACION, costo_final ya cargado, SIN CARGO: no es deuda todavia.
  ('probe-309-orden-5', 5, 'probe-309-cli-5', 'probe-309-org', 'probe-309-suc',
   'Celular', 'CELULAR', 'Placa madre', 'EN_REPARACION',
   700.00, 0, 0, 'PENDIENTE');

-- Movimientos de cuenta corriente: CARGO para 1, 2 y 4; nada para 3 (a
-- proposito); DEVOLUCION extra para 4 simulando la reversion.
INSERT INTO cuenta_corriente (
  organization_id, cliente_id, tipo, monto, saldo_posterior,
  referencia_tipo, referencia_id, sucursal_id, observaciones
) VALUES
  ('probe-309-org', 'probe-309-cli-1', 'CARGO', -1000.00, -1000.00,
   'ORDEN', 'probe-309-orden-1', 'probe-309-suc', 'probe 309'),
  ('probe-309-org', 'probe-309-cli-2', 'CARGO', -600.00, -600.00,
   'ORDEN', 'probe-309-orden-2', 'probe-309-suc', 'probe 309'),
  ('probe-309-org', 'probe-309-cli-4', 'CARGO', -500.00, -500.00,
   'ORDEN', 'probe-309-orden-4', 'probe-309-suc', 'probe 309'),
  ('probe-309-org', 'probe-309-cli-4', 'DEVOLUCION', 500.00, 0.00,
   'ORDEN', 'probe-309-orden-4', 'probe-309-suc', 'probe 309 - reversion simulada');

-- ---------------------------------------------------------------------------
-- PROBE 0 — Setup
-- ESPERADO: OK. Si dice ABORTAR, el fixture no se armó (columna NOT NULL
-- nueva, CHECK constraint que cambió, etc.) y el resto de las filas no sirve.
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 0, 'setup: 5 ordenes + 5 clientes creados', '5 / 5',
  (SELECT COUNT(*)::TEXT FROM ordenes_servicio WHERE organization_id = 'probe-309-org')
  || ' / ' ||
  (SELECT COUNT(*)::TEXT FROM clientes WHERE organization_id = 'probe-309-org');

-- ---------------------------------------------------------------------------
-- PROBE 1 — Fiado entregado sin cobro: no se duplica.
-- SIN 309 hubiera dado 2000.00 (1000 de deuda_fiado + 1000 de deuda_ordenes).
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 1, 'fiado sin cobro: deuda_total no se duplica', '1000.00',
  ROUND(d.deuda_total, 2)::TEXT
FROM get_deuda_cliente_sucursal('probe-309-org', 'probe-309-cli-1', NULL) d;

-- ---------------------------------------------------------------------------
-- PROBE 2 — Cobro parcial + resto a fiado: deuda_total es exactamente lo
-- pendiente (600), no 1200.
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 2, 'cobro parcial + fiado: deuda_total = pendiente real', '600.00',
  ROUND(d.deuda_total, 2)::TEXT
FROM get_deuda_cliente_sucursal('probe-309-org', 'probe-309-cli-2', NULL) d;

-- ---------------------------------------------------------------------------
-- PROBE 3 — Degradación: pendiente sin CARGO sigue contando (no regresión).
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 3, 'pendiente sin CARGO sigue en deuda_ordenes', '800.00',
  ROUND(d.deuda_total, 2)::TEXT
FROM get_deuda_cliente_sucursal('probe-309-org', 'probe-309-cli-3', NULL) d;

-- ---------------------------------------------------------------------------
-- PROBE 4 — CARGO revertido: la orden sigue excluida de deuda_ordenes.
-- Carga central de la regla "reverted or not": si la exclusión alguna vez
-- ganara una condición `revertido_at IS NULL`, este probe pasaría a dar
-- 500.00 (la orden reaparecería en deuda_ordenes) en vez de 0.00.
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 4, 'CARGO revertido: orden sigue excluida de deuda_ordenes', '0.00',
  ROUND(d.deuda_total, 2)::TEXT
FROM get_deuda_cliente_sucursal('probe-309-org', 'probe-309-cli-4', NULL) d;

-- ---------------------------------------------------------------------------
-- PROBE 5 — Orden EN_REPARACION con costo_final y SIN CARGO: no es deuda
-- todavía. Este es el probe que detecta la reversión de mig 267 sobre mig
-- 273: sin el filtro `o.estado IN ('REPARADO','ENTREGADO')`, esta orden
-- sumaría 700.00 pese a que el equipo sigue en el banco, sin entregar.
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 5, 'EN_REPARACION con costo_final: no cuenta como deuda', '0.00',
  ROUND(d.deuda_total, 2)::TEXT
FROM get_deuda_cliente_sucursal('probe-309-org', 'probe-309-cli-5', NULL) d;

-- ---------------------------------------------------------------------------
-- PROBE 6 — El REVOKE/GRANT de la RPC sigue en pie. La función es SECURITY
-- DEFINER e ignora RLS: sin este bloque, cualquier anon key (va en el bundle
-- del navegador) podría leer la deuda de cualquier cliente de cualquier
-- organización vía PostgREST.
-- ---------------------------------------------------------------------------
INSERT INTO _r
SELECT 6, 'permisos: public/anon/authenticated sin EXECUTE, service_role con EXECUTE',
  'false / false / false / true',
  has_function_privilege('public', 'get_deuda_cliente_sucursal(text,text,text)', 'EXECUTE')::TEXT
  || ' / ' ||
  has_function_privilege('anon', 'get_deuda_cliente_sucursal(text,text,text)', 'EXECUTE')::TEXT
  || ' / ' ||
  has_function_privilege('authenticated', 'get_deuda_cliente_sucursal(text,text,text)', 'EXECUTE')::TEXT
  || ' / ' ||
  has_function_privilege('service_role', 'get_deuda_cliente_sucursal(text,text,text)', 'EXECUTE')::TEXT;

-- ---------------------------------------------------------------------------
SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'REVISAR' END AS estado
FROM _r ORDER BY orden;

ROLLBACK;
