# Multi-Depósito Fase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ventas, reservas, ajustes y compras descuenten/repongan stock por depósito, manteniendo el invariante `inventario.stock = SUM(inventario_depositos.stock)`.

**Architecture:** Escritura dual en todas las RPCs de stock: cada RPC recibe `p_deposito_id TEXT DEFAULT NULL` (NULL → depósito principal) y actualiza `inventario.stock` (agregado) + `inventario_depositos` (detalle) en la misma transacción. Contrato de validación: `p_deposito_id` explícito → validación estricta contra ese depósito; NULL → validación global como hoy + "drain" (descuenta del principal primero, luego otros) — esto preserva el comportamiento actual para orgs de un solo depósito por construcción, sin feature flag en el camino SQL. El flag de plan (`plans.feature_flags.multi_deposito`) solo gatea el selector de depósito en la UI.

**Tech Stack:** PostgreSQL (Supabase, PL/pgSQL), Next.js App Router, Vitest (mocks de supabase), Zod.

**Entrega en 3 PRs encadenados (presupuesto 400 líneas c/u):**
- **PR A** — Migración 206: helpers + resync backfill + redefinición de RPCs. Solo SQL, comportamiento preservado.
- **PR B** — Capa app: routes aceptan `depositoId` opcional y lo pasan a las RPCs. TDD con vitest.
- **PR C** — POS: selector de depósito gateado por plan + migración 207 del flag.

**Decisiones cerradas (no re-discutir durante implementación):**
1. `inventario.stock` sigue existiendo como agregado; `inventario_depositos` es el detalle. Invariante: suma igual.
2. Venta con `p_deposito_id` NULL valida stock GLOBAL (igual que hoy) y drena: depósito principal primero, luego otros por stock DESC. Con `p_deposito_id` explícito: valida `stock - stock_reservado` de ESE depósito y falla con mensaje claro si no alcanza.
3. `inventario_depositos` tiene CHECK `stock_reservado <= stock` (más estricto que `inventario`, que no lo tiene). Al descontar stock físico de una fila, clampear: `stock_reservado = LEAST(stock_reservado, stock_nuevo)`. Espeja el comportamiento global donde pueden existir reservas huérfanas.
4. Anulación de venta restaura al depósito registrado en el movimiento `VENTA` original (`movimientos_inventario.deposito_id`); si es NULL (ventas legacy), al principal.
5. Variantes quedan FUERA: `inventario_depositos` es por `inventario_id`; stock por depósito de variantes es Fase 1.2+.
6. Numeración: migración **206** (204/205 reservadas por PRs #11 y #13 abiertos). Antes de crear el archivo, verificar que sigue libre: `eza supabase/migrations | rg "^20[4-9]"`.

**GOTCHA CRÍTICO — overloads de PostgREST:** `CREATE OR REPLACE FUNCTION` con una firma distinta (parámetro nuevo) crea una función SOBRECARGADA, no reemplaza la anterior. PostgREST falla con error de ambigüedad al llamar la RPC. TODA redefinición que agregue `p_deposito_id` debe ir precedida de `DROP FUNCTION nombre(firma_vieja_completa);`. Las firmas viejas exactas están citadas en cada task.

---

## PR A — Migración 206: SQL puro, comportamiento preservado

### Task 1: Crear migración 206 — helpers y resync backfill

**Files:**
- Create: `supabase/migrations/206_multi_deposito_fase2.sql`

- [ ] **Step 1: Crear el archivo con el bloque de helpers**

```sql
-- 206_multi_deposito_fase2.sql
-- Fase 2 multi-depósito: las RPCs de stock (venta, reserva, ajuste, compra)
-- escriben en inventario.stock (agregado) Y en inventario_depositos (detalle).
-- Contrato: p_deposito_id explícito = validación estricta en ese depósito;
-- NULL = validación global (comportamiento previo) + drain principal-primero.
-- Invariante post-migración: inventario.stock = SUM(inventario_depositos.stock).

-- ============================================================
-- 1. HELPERS
-- ============================================================

CREATE OR REPLACE FUNCTION get_deposito_principal(p_org_id TEXT)
RETURNS TEXT AS $$
  SELECT id FROM depositos
  WHERE organization_id = p_org_id AND principal = true AND deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Asegura que exista la fila (inventario, deposito) y la devuelve lockeada.
CREATE OR REPLACE FUNCTION asegurar_fila_deposito(
  p_inventario_id TEXT,
  p_deposito_id TEXT,
  p_org_id TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (p_inventario_id, p_deposito_id, 0, 0, p_org_id)
  ON CONFLICT (inventario_id, deposito_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Descuenta stock físico de inventario_depositos.
-- strict=true: solo del depósito target, error P0010 si no alcanza (stock - reservado).
-- strict=false: drain — target primero, luego otros por stock DESC. Asume que la
--   validación global ya pasó en la RPC llamadora; clampea reservado por fila
--   para respetar CHECK (stock_reservado <= stock).
-- Retorna el deposito_id donde se descontó la mayor parte (para el movimiento).
CREATE OR REPLACE FUNCTION descontar_stock_deposito(
  p_inventario_id TEXT,
  p_org_id TEXT,
  p_deposito_id TEXT,      -- NULL → principal
  p_cantidad INTEGER,
  p_strict BOOLEAN
) RETURNS TEXT AS $$
DECLARE
  v_target TEXT;
  v_restante INTEGER := p_cantidad;
  v_row RECORD;
  v_quitar INTEGER;
  v_principal_descuento INTEGER := 0;
  v_dep_resultado TEXT;
BEGIN
  v_target := COALESCE(p_deposito_id, get_deposito_principal(p_org_id));
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'ORG_SIN_DEPOSITO_PRINCIPAL: %', p_org_id USING ERRCODE = 'P0011';
  END IF;

  PERFORM asegurar_fila_deposito(p_inventario_id, v_target, p_org_id);

  IF p_strict THEN
    SELECT * INTO v_row FROM inventario_depositos
    WHERE inventario_id = p_inventario_id AND deposito_id = v_target
    FOR UPDATE;
    IF (v_row.stock - v_row.stock_reservado) < p_cantidad THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE_DEPOSITO: disponible % en depósito, solicitado %',
        (v_row.stock - v_row.stock_reservado), p_cantidad USING ERRCODE = 'P0010';
    END IF;
    UPDATE inventario_depositos
    SET stock = stock - p_cantidad,
        stock_reservado = LEAST(stock_reservado, stock - p_cantidad),
        updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_target;
    RETURN v_target;
  END IF;

  -- Drain: target primero, luego otros por stock DESC.
  FOR v_row IN
    SELECT idep.deposito_id, idep.stock
    FROM inventario_depositos idep
    WHERE idep.inventario_id = p_inventario_id AND idep.stock > 0
    ORDER BY (idep.deposito_id = v_target) DESC, idep.stock DESC, idep.deposito_id
    FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;
    v_quitar := LEAST(v_row.stock, v_restante);
    UPDATE inventario_depositos
    SET stock = stock - v_quitar,
        stock_reservado = LEAST(stock_reservado, stock - v_quitar),
        updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_row.deposito_id;
    IF v_quitar > v_principal_descuento THEN
      v_principal_descuento := v_quitar;
      v_dep_resultado := v_row.deposito_id;
    END IF;
    v_restante := v_restante - v_quitar;
  END LOOP;

  -- Si el detalle no alcanzó (desync histórico), absorber el resto en el target.
  -- La validación global ya garantizó stock total; esto solo corrige detalle stale.
  IF v_restante > 0 THEN
    UPDATE inventario_depositos
    SET stock = GREATEST(stock - v_restante, 0),
        stock_reservado = LEAST(stock_reservado, GREATEST(stock - v_restante, 0)),
        updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_target;
  END IF;

  RETURN COALESCE(v_dep_resultado, v_target);
END;
$$ LANGUAGE plpgsql;

-- Incrementa stock físico en un depósito (entradas: compra, anulación, devolución, ajuste +).
CREATE OR REPLACE FUNCTION incrementar_stock_deposito(
  p_inventario_id TEXT,
  p_org_id TEXT,
  p_deposito_id TEXT,      -- NULL → principal
  p_cantidad INTEGER
) RETURNS TEXT AS $$
DECLARE
  v_target TEXT;
BEGIN
  v_target := COALESCE(p_deposito_id, get_deposito_principal(p_org_id));
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'ORG_SIN_DEPOSITO_PRINCIPAL: %', p_org_id USING ERRCODE = 'P0011';
  END IF;
  PERFORM asegurar_fila_deposito(p_inventario_id, v_target, p_org_id);
  UPDATE inventario_depositos
  SET stock = stock + p_cantidad, updated_at = NOW()
  WHERE inventario_id = p_inventario_id AND deposito_id = v_target;
  RETURN v_target;
END;
$$ LANGUAGE plpgsql;

-- Reserva en el detalle por depósito. strict análogo a descontar_stock_deposito.
-- CHECK (stock_reservado <= stock) limita cuánto se puede reservar por fila;
-- en modo drain, reparte la reserva entre filas con capacidad (stock - reservado).
CREATE OR REPLACE FUNCTION reservar_stock_deposito(
  p_inventario_id TEXT,
  p_org_id TEXT,
  p_deposito_id TEXT,
  p_cantidad INTEGER,
  p_strict BOOLEAN
) RETURNS TEXT AS $$
DECLARE
  v_target TEXT;
  v_restante INTEGER := p_cantidad;
  v_row RECORD;
  v_poner INTEGER;
BEGIN
  v_target := COALESCE(p_deposito_id, get_deposito_principal(p_org_id));
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'ORG_SIN_DEPOSITO_PRINCIPAL: %', p_org_id USING ERRCODE = 'P0011';
  END IF;
  PERFORM asegurar_fila_deposito(p_inventario_id, v_target, p_org_id);

  IF p_strict THEN
    SELECT * INTO v_row FROM inventario_depositos
    WHERE inventario_id = p_inventario_id AND deposito_id = v_target
    FOR UPDATE;
    IF (v_row.stock - v_row.stock_reservado) < p_cantidad THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE_DEPOSITO: disponible % en depósito, solicitado %',
        (v_row.stock - v_row.stock_reservado), p_cantidad USING ERRCODE = 'P0010';
    END IF;
    UPDATE inventario_depositos
    SET stock_reservado = stock_reservado + p_cantidad, updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_target;
    RETURN v_target;
  END IF;

  FOR v_row IN
    SELECT idep.deposito_id, (idep.stock - idep.stock_reservado) AS capacidad
    FROM inventario_depositos idep
    WHERE idep.inventario_id = p_inventario_id AND (idep.stock - idep.stock_reservado) > 0
    ORDER BY (idep.deposito_id = v_target) DESC, capacidad DESC, idep.deposito_id
    FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;
    v_poner := LEAST(v_row.capacidad, v_restante);
    UPDATE inventario_depositos
    SET stock_reservado = stock_reservado + v_poner, updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_row.deposito_id;
    v_restante := v_restante - v_poner;
  END LOOP;
  -- Si v_restante > 0: la reserva global excede el detalle (desync). No forzar:
  -- el CHECK lo impide. El agregado en inventario.stock_reservado sigue siendo
  -- la fuente para validación global; el detalle queda parcial. Aceptado.
  RETURN v_target;
END;
$$ LANGUAGE plpgsql;

-- Libera reserva en el detalle. Drena de filas con reservado > 0 (target primero).
CREATE OR REPLACE FUNCTION liberar_reserva_deposito(
  p_inventario_id TEXT,
  p_org_id TEXT,
  p_deposito_id TEXT,
  p_cantidad INTEGER
) RETURNS TEXT AS $$
DECLARE
  v_target TEXT;
  v_restante INTEGER := p_cantidad;
  v_row RECORD;
  v_quitar INTEGER;
BEGIN
  v_target := COALESCE(p_deposito_id, get_deposito_principal(p_org_id));
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'ORG_SIN_DEPOSITO_PRINCIPAL: %', p_org_id USING ERRCODE = 'P0011';
  END IF;
  FOR v_row IN
    SELECT idep.deposito_id, idep.stock_reservado
    FROM inventario_depositos idep
    WHERE idep.inventario_id = p_inventario_id AND idep.stock_reservado > 0
    ORDER BY (idep.deposito_id = v_target) DESC, idep.stock_reservado DESC, idep.deposito_id
    FOR UPDATE
  LOOP
    EXIT WHEN v_restante <= 0;
    v_quitar := LEAST(v_row.stock_reservado, v_restante);
    UPDATE inventario_depositos
    SET stock_reservado = stock_reservado - v_quitar, updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_row.deposito_id;
    v_restante := v_restante - v_quitar;
  END LOOP;
  RETURN v_target;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Agregar el bloque de resync backfill al final del archivo**

`inventario_depositos` está stale desde mig. 169 (ventas/ajustes/compras solo tocaron el agregado). Reconciliar contra `inventario.stock` absorbiendo la diferencia en el principal; si el principal no alcanza (org transfirió stock y después vendió), reducir otros depósitos de mayor a menor.

```sql
-- ============================================================
-- 2. RESYNC BACKFILL: SUM(inventario_depositos.stock) = inventario.stock
-- ============================================================
DO $$
DECLARE
  v_item RECORD;
  v_principal TEXT;
  v_suma INTEGER;
  v_delta INTEGER;
  v_row RECORD;
  v_quitar INTEGER;
BEGIN
  FOR v_item IN
    SELECT i.id, i.organization_id, i.stock, i.stock_reservado
    FROM inventario i
  LOOP
    v_principal := get_deposito_principal(v_item.organization_id);
    CONTINUE WHEN v_principal IS NULL;

    PERFORM asegurar_fila_deposito(v_item.id, v_principal, v_item.organization_id);

    SELECT COALESCE(SUM(stock), 0) INTO v_suma
    FROM inventario_depositos WHERE inventario_id = v_item.id;

    v_delta := v_item.stock - v_suma;  -- >0: faltante en detalle; <0: sobrante

    IF v_delta > 0 THEN
      UPDATE inventario_depositos
      SET stock = stock + v_delta, updated_at = NOW()
      WHERE inventario_id = v_item.id AND deposito_id = v_principal;
    ELSIF v_delta < 0 THEN
      v_delta := -v_delta;
      -- Reducir principal primero, luego otros de mayor a menor.
      FOR v_row IN
        SELECT deposito_id, stock FROM inventario_depositos
        WHERE inventario_id = v_item.id AND stock > 0
        ORDER BY (deposito_id = v_principal) DESC, stock DESC, deposito_id
      LOOP
        EXIT WHEN v_delta <= 0;
        v_quitar := LEAST(v_row.stock, v_delta);
        UPDATE inventario_depositos
        SET stock = stock - v_quitar,
            stock_reservado = LEAST(stock_reservado, stock - v_quitar),
            updated_at = NOW()
        WHERE inventario_id = v_item.id AND deposito_id = v_row.deposito_id;
        v_delta := v_delta - v_quitar;
      END LOOP;
    END IF;

    -- Resync de reservas: borrar detalle y re-asignar inventario.stock_reservado
    -- al principal (clampeado por capacidad), spill a otros si no entra.
    UPDATE inventario_depositos SET stock_reservado = 0, updated_at = NOW()
    WHERE inventario_id = v_item.id AND stock_reservado <> 0;

    IF v_item.stock_reservado > 0 THEN
      v_delta := v_item.stock_reservado;
      FOR v_row IN
        SELECT deposito_id, stock FROM inventario_depositos
        WHERE inventario_id = v_item.id AND stock > 0
        ORDER BY (deposito_id = v_principal) DESC, stock DESC, deposito_id
      LOOP
        EXIT WHEN v_delta <= 0;
        v_quitar := LEAST(v_row.stock, v_delta);
        UPDATE inventario_depositos
        SET stock_reservado = v_quitar, updated_at = NOW()
        WHERE inventario_id = v_item.id AND deposito_id = v_row.deposito_id;
        v_delta := v_delta - v_quitar;
      END LOOP;
      -- v_delta > 0 acá = reservas huérfanas (reservado > stock total). Quedan
      -- solo en el agregado, igual que hoy. No forzar al detalle.
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/206_multi_deposito_fase2.sql
git commit -m "feat(db): multi-deposito fase 2 - helpers de stock por deposito y resync backfill"
```

---

### Task 2: Redefinir RPCs de ajuste y compra en la migración 206

**Files:**
- Modify: `supabase/migrations/206_multi_deposito_fase2.sql` (append)
- Reference (leer, no tocar): `supabase/migrations/148_adjust_stock_atomic.sql:23`, `supabase/migrations/185_ajustes_inventario_merma.sql:55`, `supabase/migrations/110_oc_items_free_form.sql:24`

Estas tres son las redefiniciones simples (operan sobre UN depósito, sin drain de salida complejo). Patrón idéntico para las tres:

- [ ] **Step 1: Redefinir `adjust_stock_atomic`**

Copiar la definición completa desde `148_adjust_stock_atomic.sql:23` y aplicar exactamente estos cambios:

```sql
-- ANTES de la nueva definición (firma vieja exacta, evita overload PostgREST):
DROP FUNCTION IF EXISTS adjust_stock_atomic(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT);
```

Cambios sobre el cuerpo copiado:
1. Firma: agregar último parámetro `p_deposito_id TEXT DEFAULT NULL`.
2. En DECLARE agregar: `v_deposito_efectivo TEXT;`
3. Después del `UPDATE inventario SET stock = ...` (el update del agregado), insertar:

```sql
  IF v_stock_posterior > v_stock_anterior THEN
    v_deposito_efectivo := incrementar_stock_deposito(
      p_inventario_id, p_organization_id, p_deposito_id,
      v_stock_posterior - v_stock_anterior);
  ELSE
    v_deposito_efectivo := descontar_stock_deposito(
      p_inventario_id, p_organization_id, p_deposito_id,
      v_stock_anterior - v_stock_posterior,
      p_deposito_id IS NOT NULL);
  END IF;
```

4. En el `INSERT INTO movimientos_inventario`: agregar columna `deposito_id` con valor `v_deposito_efectivo`.

- [ ] **Step 2: Redefinir `aplicar_ajuste_inventario`**

Mismo patrón. Firma vieja para el DROP:

```sql
DROP FUNCTION IF EXISTS aplicar_ajuste_inventario(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT);
```

Copiar de `185_ajustes_inventario_merma.sql:55`, agregar `p_deposito_id TEXT DEFAULT NULL` al final de la firma, y tras el `UPDATE inventario.stock`: si `p_direccion = 'ENTRADA'` llamar `incrementar_stock_deposito(...)`, si `'SALIDA'` llamar `descontar_stock_deposito(..., p_deposito_id IS NOT NULL)`. Registrar `deposito_id = v_deposito_efectivo` en el movimiento.

- [ ] **Step 3: Redefinir `recibir_orden_compra`**

```sql
DROP FUNCTION IF EXISTS recibir_orden_compra(TEXT, TEXT, JSONB);
```

Copiar de `110_oc_items_free_form.sql:24`, agregar `p_deposito_id TEXT DEFAULT NULL`. En el bloque que hace `UPDATE inventario SET stock = stock + cantidadRecibida`, agregar a continuación:

```sql
  v_deposito_efectivo := incrementar_stock_deposito(
    v_inventario_id, v_org_id, p_deposito_id, v_cantidad_recibida);
```

(declarar `v_deposito_efectivo TEXT;`) y poblar `deposito_id` en el movimiento `COMPRA_RECIBIDA`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/206_multi_deposito_fase2.sql
git commit -m "feat(db): adjust_stock_atomic, aplicar_ajuste_inventario y recibir_orden_compra escriben stock por deposito"
```

---

### Task 3: Redefinir RPCs de venta en la migración 206

**Files:**
- Modify: `supabase/migrations/206_multi_deposito_fase2.sql` (append)
- Reference: `supabase/migrations/200_series_en_venta_e_idempotencia.sql:48` (crear_venta_atomica), `supabase/migrations/083_inventario_critical_fixes.sql:246` (editar_venta_atomica), `supabase/migrations/043_mejoras_inventario_ventas.sql:578` (restore_stock_on_cancel)

- [ ] **Step 1: Redefinir `crear_venta_atomica`**

Firma vieja exacta para el DROP (verificar contra mig. 200 antes de escribir — 19 parámetros):

```sql
DROP FUNCTION IF EXISTS crear_venta_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, TEXT, INTEGER, DECIMAL, DECIMAL, JSONB, JSONB, TEXT);
```

Copiar la definición completa desde `200_series_en_venta_e_idempotencia.sql:48` y aplicar:
1. Firma: agregar `p_deposito_id TEXT DEFAULT NULL` al final.
2. DECLARE: agregar `v_deposito_efectivo TEXT;`
3. La validación de stock acumulativa por `inventario_id` NO CAMBIA cuando `p_deposito_id IS NULL` (sigue validando `inventario.stock` global). Cuando `p_deposito_id IS NOT NULL`, la validación estricta la hace `descontar_stock_deposito` con strict=true — la validación global existente queda como pre-chequeo (más laxa, no molesta).
4. En el loop de items, inmediatamente después del `UPDATE inventario SET stock = stock - v_cantidad` (el del agregado, con la guarda `WHERE stock >= cantidad`), agregar:

```sql
    v_deposito_efectivo := descontar_stock_deposito(
      v_inventario_id, p_org_id, p_deposito_id, v_cantidad,
      p_deposito_id IS NOT NULL);
```

5. En el `INSERT INTO movimientos_inventario` del tipo `VENTA`: agregar columna `deposito_id` con `v_deposito_efectivo`.
6. NO tocar la lógica de series, pagos, caja ni idempotencia. El diff es solo los 5 puntos de arriba.

- [ ] **Step 2: Redefinir `editar_venta_atomica`**

```sql
DROP FUNCTION IF EXISTS editar_venta_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL, TEXT, TEXT, JSONB);
```

Copiar de `083_inventario_critical_fixes.sql:246`, agregar `p_deposito_id TEXT DEFAULT NULL`. Dos inserciones:
1. En el loop de RESTAURACIÓN de items viejos (el `UPDATE inventario SET stock = stock + cantidad`): restaurar el detalle al depósito del movimiento VENTA original de esa venta. Antes del loop, no hay forma simple de mapear item→movimiento; usar el mismo criterio que la anulación (Step 3): buscar `deposito_id` del último movimiento `VENTA` de esa venta para ese `inventario_id`:

```sql
    SELECT m.deposito_id INTO v_dep_origen
    FROM movimientos_inventario m
    WHERE m.referencia_id = p_venta_id AND m.tipo = 'VENTA'
      AND m.inventario_id = v_item_viejo.inventario_id
    ORDER BY m.created_at DESC LIMIT 1;
    PERFORM incrementar_stock_deposito(
      v_item_viejo.inventario_id, p_org_id, v_dep_origen, v_item_viejo.cantidad);
```

(declarar `v_dep_origen TEXT;` — si es NULL, `incrementar_stock_deposito` resuelve al principal)
2. En el loop de DESCUENTO de items nuevos: igual que crear_venta_atomica punto 4. Poblar `deposito_id` en ambos movimientos (ANULACION y VENTA).

- [ ] **Step 3: Redefinir `restore_stock_on_cancel` (trigger function)**

Sin DROP (la firma de trigger no cambia). `CREATE OR REPLACE` copiando de `043_mejoras_inventario_ventas.sql:578`. En el loop por `items_venta`, después del `UPDATE inventario SET stock = stock + cantidad`:

```sql
    SELECT m.deposito_id INTO v_dep_origen
    FROM movimientos_inventario m
    WHERE m.referencia_id = NEW.id AND m.tipo = 'VENTA'
      AND m.inventario_id = v_item.inventario_id
    ORDER BY m.created_at DESC LIMIT 1;
    PERFORM incrementar_stock_deposito(
      v_item.inventario_id, NEW.organization_id, v_dep_origen, v_item.cantidad);
```

y poblar `deposito_id = v_dep_origen` (puede ser NULL → queda NULL, aceptable en ANULACION legacy) en el movimiento ANULACION.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/206_multi_deposito_fase2.sql
git commit -m "feat(db): crear/editar venta y anulacion escriben stock por deposito"
```

---

### Task 4: Redefinir RPCs de reserva en la migración 206

**Files:**
- Modify: `supabase/migrations/206_multi_deposito_fase2.sql` (append)
- Reference: `supabase/migrations/108_inventario_stock_reservado.sql` (líneas 38, 100, 216, 271, 332), `supabase/migrations/151_fix_add_repuesto_precio_compra.sql:17`

Patrón común: tras cada `UPDATE inventario SET stock_reservado = ...`, replicar en el detalle con el helper correspondiente. Ninguna de estas RPCs recibe `p_deposito_id` en esta fase (las reservas de órdenes/cotizaciones siguen siendo "globales" = principal-first); se agrega el parámetro igual con DEFAULT NULL para tener la firma lista, pero la UI no lo usa hasta Fase 1.2+.

- [ ] **Step 1: `reservar_items_cotizacion`** — DROP `(TEXT, TEXT)`, copiar de 108:38, agregar `p_deposito_id TEXT DEFAULT NULL`. Tras el incremento de `inventario.stock_reservado`: `PERFORM reservar_stock_deposito(v_inventario_id, v_org_id, p_deposito_id, v_cantidad, false);` y poblar `deposito_id` en el movimiento RESERVA.

- [ ] **Step 2: `liberar_items_cotizacion`** — DROP `(TEXT, TEXT, TEXT)`, copiar de 108:100, agregar param. Tras el decremento: `PERFORM liberar_reserva_deposito(v_inventario_id, v_org_id, p_deposito_id, v_liberar);` (donde `v_liberar` es el `LEAST(...)` ya calculado). Poblar movimiento.

- [ ] **Step 3: `add_repuesto_inventario`** — DROP `(TEXT, TEXT, INTEGER)`, copiar de 151:17, agregar param. Tras el incremento de reserva: `PERFORM reservar_stock_deposito(p_inventario_id, v_org_id, p_deposito_id, p_cantidad, false);`. Poblar movimiento.

- [ ] **Step 4: `remove_repuesto_inventario`** — DROP `(TEXT)`, copiar de 108:216. Tras liberar: `PERFORM liberar_reserva_deposito(v_inventario_id, v_org_id, NULL, v_liberar);`. Poblar movimiento.

- [ ] **Step 5: `consumir_reservas_orden`** — DROP `(TEXT, TEXT)`, copiar de 108:271, agregar param. Acá hay DOS efectos por item: descuento físico + liberación de reserva. Tras los UPDATE del agregado:

```sql
    v_deposito_efectivo := descontar_stock_deposito(
      v_rep.inventario_id, v_org_id, p_deposito_id, v_rep.cantidad,
      p_deposito_id IS NOT NULL);
    PERFORM liberar_reserva_deposito(
      v_rep.inventario_id, v_org_id, v_deposito_efectivo, v_liberar);
```

Poblar `deposito_id = v_deposito_efectivo` en el movimiento SALIDA.

- [ ] **Step 6: `liberar_reservas_orden`** — DROP `(TEXT, TEXT)`, copiar de 108:332, agregar param. Tras liberar: `PERFORM liberar_reserva_deposito(v_rep.inventario_id, v_org_id, p_deposito_id, v_liberar);`. Poblar movimiento.

- [ ] **Step 7: Localizar el flujo de devoluciones y aplicar el patrón**

Run: `rg -n "DEVOLUCION" --type ts app/api/ | rg -v test` y `rg -ln "restaurar_stock" supabase/migrations/ app/api/`
Si el restore de stock de devoluciones vive en una route TS con UPDATE directo a `inventario`: agregar tras ese update una llamada RPC nueva NO es viable desde TS sin función — en ese caso agregar al final de la migración 206 una RPC `registrar_devolucion_stock(p_inventario_id TEXT, p_org_id TEXT, p_cantidad INTEGER, p_deposito_id TEXT DEFAULT NULL)` que haga el `UPDATE inventario` + `incrementar_stock_deposito` + movimiento DEVOLUCION, y migrar la route a usarla. Si ya existe una función SQL de devolución: aplicarle el patrón de Task 2 Step 3.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/206_multi_deposito_fase2.sql
git commit -m "feat(db): reservas de ordenes/cotizaciones/repuestos replican en stock por deposito"
```

---

### Task 5: Aplicar migración y verificar invariante

- [ ] **Step 1: Aplicar la migración 206 a la DB** (mismo método usado para 204/205: Supabase SQL editor o `npx supabase db push` según setup de la sesión — confirmar con el usuario qué método usa si no hay credenciales locales)

- [ ] **Step 2: Verificar invariante con estas queries (deben dar 0 filas):**

```sql
-- Stock detalle vs agregado
SELECT i.id, i.codigo, i.stock, COALESCE(SUM(idep.stock),0) AS detalle
FROM inventario i LEFT JOIN inventario_depositos idep ON idep.inventario_id = i.id
GROUP BY i.id, i.codigo, i.stock
HAVING i.stock <> COALESCE(SUM(idep.stock),0);

-- Sin overloads ambiguos (debe devolver 1 fila por función, no 2)
SELECT proname, COUNT(*) FROM pg_proc
WHERE proname IN ('crear_venta_atomica','editar_venta_atomica','adjust_stock_atomic',
  'aplicar_ajuste_inventario','recibir_orden_compra','reservar_items_cotizacion',
  'liberar_items_cotizacion','add_repuesto_inventario','remove_repuesto_inventario',
  'consumir_reservas_orden','liberar_reservas_orden')
GROUP BY proname HAVING COUNT(*) > 1;
```

- [ ] **Step 3: Smoke funcional mínimo:** crear una venta de prueba vía POS en entorno local/staging, verificar que `movimientos_inventario.deposito_id` quedó poblado y que la query de invariante sigue en 0 filas. Anular la venta, repetir verificación.

- [ ] **Step 4: Abrir PR A** (base: main) con `superpowers:requesting-code-review` antes del push.

---

## PR B — Capa app: routes aceptan `depositoId` (TDD estricto)

### Task 6: `POST /api/ventas` acepta `depositoId`

**Files:**
- Modify: `app/api/ventas/route.ts` (schema Zod + rpc call línea ~231)
- Test: `__tests__/api/ventas.test.ts`

- [ ] **Step 1: Test que falla** — siguiendo el patrón existente de `ventas.test.ts:269`:

```ts
it("pasa depositoId a la RPC como p_deposito_id", async () => {
  mockAuthSuccess()
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null })
  // reusar el mockSupabaseFrom del test de creación exitosa existente
  const res = await POST(createPostRequest({ ...ventaBodyValido, depositoId: "dep-2" }))
  const { status } = await parseResponse(res)
  expect(status).toBe(201)
  const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as Record<string, unknown>
  expect(rpcArgs.p_deposito_id).toBe("dep-2")
})

it("manda p_deposito_id null cuando el body no trae depositoId", async () => {
  // mismo setup sin depositoId
  expect(rpcArgs.p_deposito_id).toBeNull()
})
```

- [ ] **Step 2: Correr y verificar FAIL** — `npm run test:run -- __tests__/api/ventas.test.ts` → los 2 tests nuevos fallan (`p_deposito_id` undefined).

- [ ] **Step 3: Implementar** — en el schema Zod del body agregar `depositoId: z.string().min(1).nullable().optional()`; en el objeto de params de la RPC agregar `p_deposito_id: data.depositoId ?? null`.

- [ ] **Step 4: Correr y verificar PASS** — mismo comando, suite del archivo completa en verde (los tests viejos no deben romperse: el param nuevo tiene default en SQL).

- [ ] **Step 5: Commit** — `git commit -m "feat(ventas): POST acepta depositoId opcional y lo pasa a crear_venta_atomica"`

### Task 7: `PUT /api/ventas/[id]`, `POST /api/inventario/[id]/stock` y `POST /api/ordenes-compra/[id]/recibir` aceptan `depositoId`

**Files:**
- Modify: `app/api/ventas/[id]/route.ts:188`, `app/api/inventario/[id]/stock/route.ts:38`, `app/api/ordenes-compra/[id]/recibir/route.ts:45`
- Test: `__tests__/api/ventas.test.ts` (o archivo propio si PUT no tiene), `__tests__/api/` correspondientes

- [ ] **Step 1-4:** Mismo ciclo TDD de Task 6 para cada route: test `p_deposito_id` con valor y null → FAIL → agregar `depositoId` al schema Zod + param RPC → PASS. Un commit por route:

```bash
git commit -m "feat(ventas): PUT acepta depositoId opcional"
git commit -m "feat(inventario): ajuste de stock acepta depositoId opcional"
git commit -m "feat(compras): recepcion de OC acepta depositoId opcional"
```

- [ ] **Step 5: Suite completa + typecheck** — `npm run test:run` (714+ tests verdes) y `npx tsc --noEmit`.

- [ ] **Step 6: Abrir PR B** (base: rama de PR A — chained).

---

## PR C — POS: selector de depósito gateado por plan

### Task 8: Migración 207 — flag `multi_deposito` en planes

**Files:**
- Create: `supabase/migrations/207_multi_deposito_plan_flag.sql`

- [ ] **Step 1: Crear migración** (verificar antes que 207 sigue libre):

```sql
-- Habilita multi_deposito en planes pagos. Free queda sin selector (usa principal).
UPDATE plans
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"multi_deposito": true}'::jsonb
WHERE slug IN ('profesional', 'pro');
```

(Confirmar slugs reales: `rg -n "slug" supabase/migrations/187_free_plan_v2_loosen.sql`)

- [ ] **Step 2: Commit** — `git commit -m "feat(db): flag multi_deposito en planes pagos"`

### Task 9: Selector de depósito en POS

**Files:**
- Modify: `components/pos/pos-terminal.tsx` (estado `depositoId` + fetch), `components/pos/pos-checkout-dialog.tsx:95-174` (payload), `components/pos/pos-types.ts` (props)
- Test: `components/pos/__tests__/pos-deposito.test.ts` (patrón de `pos-series.test.ts`)

- [ ] **Step 1: Test que falla** — el payload del checkout incluye `depositoId` cuando hay depósito seleccionado, y lo omite/null cuando no:

```ts
// patrón de pos-series.test.ts: testear el builder del payload, no el render
it("incluye depositoId en el payload cuando hay deposito activo", () => {
  const payload = buildVentaPayload({ ...inputsBase, depositoId: "dep-2" })
  expect(payload.depositoId).toBe("dep-2")
})
it("manda depositoId null sin seleccion", () => {
  const payload = buildVentaPayload(inputsBase)
  expect(payload.depositoId).toBeNull()
})
```

Si `pos-checkout-dialog.tsx` arma el payload inline en `handleSubmit`, extraer primero un builder puro `buildVentaPayload()` a `components/pos/pos-payload.ts` (refactor mecánico, sin cambio de comportamiento, commit separado) y testear ese builder.

- [ ] **Step 2: FAIL** — `npm run test:run -- components/pos`

- [ ] **Step 3: Implementar:**
1. `pos-terminal.tsx`: estado `depositoId: string | null` (default null = principal). Al montar, `GET /api/depositos` + chequeo del flag de plan (la subscription de la org ya se consume en el dashboard; usar `hasPlanFeature` vía un endpoint existente de subscription o el campo que exponga — verificar con `rg -n "feature_flags|hasPlanFeature" app/api/ lib/`). Selector visible SOLO si: flag activo Y hay ≥2 depósitos activos. UI: `Select` compacto en el header del terminal, default "Principal".
2. Prop-drill `depositoId` al `PosCheckoutDialog`; incluirlo en el payload del POST.
3. UI copy en español neutro del proyecto (es la convención del codebase existente).

- [ ] **Step 4: PASS** — `npm run test:run -- components/pos` y suite completa.

- [ ] **Step 5: Verificación visual** — `npm run dev`, POS con org de 1 depósito (sin selector visible), org con 2 depósitos y plan pago (selector visible, venta descuenta del seleccionado — verificar en `movimientos_inventario.deposito_id`).

- [ ] **Step 6: Commit + PR C** (base: rama de PR B).

```bash
git commit -m "feat(pos): selector de deposito gateado por plan multi_deposito"
```

---

## Verificación final de la fase

- [ ] Org de prueba con 2 depósitos: ciclo completo venta → anulación → reserva por cotización → conversión a venta → entrega de orden con repuestos → recepción de OC → transferencia. Tras CADA paso, query de invariante (Task 5 Step 2) = 0 filas.
- [ ] `npm run test:run` completo en verde.
- [ ] Actualizar spec: marcar Fase 1.1 entregada en `docs/superpowers/specs/2026-06-12-inventario-profesional-design.md`.
