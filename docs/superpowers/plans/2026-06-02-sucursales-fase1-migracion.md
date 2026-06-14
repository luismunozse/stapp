# Sucursales — Fase 1: Migración y Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear la tabla `sucursales`, agregar `sucursal_id` a las entidades operativas, hacer backfill idempotente de toda la data existente a una sucursal "Casa Central" por org, y dejar la base de datos de planes lista para el tier Pro — sin cambiar el comportamiento funcional de producción.

**Architecture:** Migraciones SQL puras aplicadas a mano en el SQL Editor de Supabase (no hay CLI ni tests de DB en este repo — ver `SETUP.md`). Cada migración es idempotente, espejo del estilo de `169_multi_deposito.sql`. La verificación es vía queries SQL con output esperado. Producción queda con 1 sola sucursal por org ⇒ comportamiento idéntico al actual.

**Tech Stack:** PostgreSQL (Supabase), SQL Editor del dashboard. Sin código de aplicación en esta fase.

---

## Contexto previo (leer antes de empezar)

- **Cómo se aplican migraciones**: NO hay `supabase db push` ni CLI. Se pega el contenido del `.sql` en el **SQL Editor** del dashboard de Supabase y se ejecuta. Ver `SETUP.md:54`. Por eso cada migración es idempotente (`IF NOT EXISTS`, `WHERE NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`): re-ejecutarla no rompe ni duplica.
- **Molde a copiar**: `supabase/migrations/169_multi_deposito.sql` — misma estructura de tabla (`principal`, `deleted_at`, índices parciales únicos, RLS select-por-org + all-service-role, trigger `updated_at`) y mismo patrón de backfill.
- **Helpers SQL ya existentes** (migración 001): `generate_cuid()` (default de PKs TEXT) y `update_updated_at()` (trigger de `updated_at`). No redefinir.
- **Última migración**: `200_series_en_venta_e_idempotencia.sql`. Las nuevas arrancan en `201`.
- **Planes** (migración 006): enum `plan_type = ('FREE','PREMIUM')`. La fila PREMIUM se muestra como "Profesional". Función `check_plan_limit(org_id TEXT, limit_type TEXT)` lee de `organization_usage`. Decisión de negocio: FREE=1 sucursal, PREMIUM/Profesional=3, PRO (nuevo)=ilimitado.
- **Punto fino Postgres**: `ALTER TYPE ... ADD VALUE` no puede usarse en la misma transacción que luego referencia el value nuevo. Por eso el enum PRO (Task 3) y su uso (Task 4) van en **migraciones separadas** que se ejecutan una después de la otra.

## File Structure

- Create: `supabase/migrations/201_sucursales_tabla.sql` — tabla `sucursales` + índices + RLS + trigger + backfill "Casa Central".
- Create: `supabase/migrations/202_sucursales_scope_columns.sql` — `sucursal_id` en las 6 tablas + backfill a Casa Central + `NOT NULL` (salvo `users`) + índices compuestos.
- Create: `supabase/migrations/203_plan_pro_enum.sql` — `ALTER TYPE plan_type ADD VALUE 'PRO'` (aislada).
- Create: `supabase/migrations/204_plan_sucursales.sql` — `plans.limite_sucursales`, valores por tier, fila PRO, `organization_usage.sucursales_count` + backfill, extensión de `check_plan_limit`.

Cada archivo es autocontenido y se ejecuta en orden (201 → 202 → 203 → 204).

---

### Task 1: Tabla `sucursales` + backfill "Casa Central"

**Files:**
- Create: `supabase/migrations/201_sucursales_tabla.sql`

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/201_sucursales_tabla.sql` con este contenido exacto:

```sql
-- ========================================
-- 201: SUCURSALES (FASE 1) — tabla + backfill Casa Central
-- ========================================
-- Introduce el concepto de sucursal (local físico) por organización.
-- Molde: 169_multi_deposito.sql. Idempotente: re-ejecutar no duplica.
-- Cada org recibe una sucursal principal "Casa Central" vía backfill.

-- ========================================
-- 1. TABLA sucursales
-- ========================================

CREATE TABLE IF NOT EXISTS sucursales (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  codigo TEXT,
  direccion TEXT,
  telefono TEXT,
  notas TEXT,
  principal BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nombre único por org (entre activos)
CREATE UNIQUE INDEX IF NOT EXISTS sucursales_org_nombre_unique
  ON sucursales(organization_id, LOWER(nombre))
  WHERE deleted_at IS NULL;

-- Solo 1 principal por org
CREATE UNIQUE INDEX IF NOT EXISTS sucursales_org_principal_unique
  ON sucursales(organization_id)
  WHERE principal = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS sucursales_org_idx
  ON sucursales(organization_id) WHERE deleted_at IS NULL;

ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sucursales_select ON sucursales;
CREATE POLICY sucursales_select ON sucursales
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS sucursales_all_service ON sucursales;
CREATE POLICY sucursales_all_service ON sucursales
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS sucursales_updated_at ON sucursales;
CREATE TRIGGER sucursales_updated_at
  BEFORE UPDATE ON sucursales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 2. BACKFILL: sucursal "Casa Central" por org
-- ========================================

INSERT INTO sucursales (organization_id, nombre, principal, activo)
SELECT o.id, 'Casa Central', true, true
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM sucursales s
  WHERE s.organization_id = o.id
    AND s.principal = true
    AND s.deleted_at IS NULL
);
```

- [ ] **Step 2: Aplicar en el SQL Editor de Supabase**

Pegar el contenido completo de `201_sucursales_tabla.sql` en el SQL Editor del dashboard de Supabase (entorno de desarrollo/staging) y ejecutar.
Esperado: ejecución sin errores. Mensaje "Success. No rows returned".

- [ ] **Step 3: Verificar — toda org tiene exactamente 1 principal**

Ejecutar en el SQL Editor:

```sql
SELECT
  (SELECT COUNT(*) FROM organizations) AS orgs,
  (SELECT COUNT(*) FROM sucursales WHERE principal = true AND deleted_at IS NULL) AS principales;
```

Esperado: `orgs == principales` (mismo número en ambas columnas). Cada org tiene 1 Casa Central.

- [ ] **Step 4: Verificar idempotencia**

Re-ejecutar el contenido completo de `201_sucursales_tabla.sql` una segunda vez.
Esperado: sin errores, sin filas nuevas. Re-correr la query del Step 3 ⇒ mismos números (no se duplicó ninguna Casa Central).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/201_sucursales_tabla.sql
git commit -m "feat(sucursales): tabla sucursales + backfill Casa Central por org"
```

---

### Task 2: Columnas `sucursal_id` + backfill de data existente

**Files:**
- Create: `supabase/migrations/202_sucursales_scope_columns.sql`

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/202_sucursales_scope_columns.sql` con este contenido exacto:

```sql
-- ========================================
-- 202: SUCURSALES — columnas sucursal_id + backfill + NOT NULL
-- ========================================
-- Agrega sucursal_id a las entidades operativas, vuelca toda la data
-- existente a la Casa Central de su org, y aplica NOT NULL (salvo users).
-- Idempotente: ADD COLUMN IF NOT EXISTS + backfill por WHERE sucursal_id IS NULL.

-- ========================================
-- 1. AGREGAR COLUMNAS (nullable primero)
-- ========================================

ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);
ALTER TABLE ventas           ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);
ALTER TABLE sesiones_caja    ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);
ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);
ALTER TABLE depositos        ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);
ALTER TABLE users            ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);

-- ========================================
-- 2. BACKFILL: data existente -> Casa Central de su org
-- ========================================
-- Helper CTE no aplica entre statements; repetimos el JOIN al principal.

UPDATE ordenes_servicio t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

UPDATE ventas t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

UPDATE sesiones_caja t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

UPDATE movimientos_caja t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

UPDATE depositos t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

-- users: solo TECNICO/VENDEDOR quedan atados a Casa Central.
-- ADMIN queda NULL (= ve todas las sucursales).
UPDATE users t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND t.rol <> 'ADMIN'
  AND s.organization_id = t.organization_id
  AND s.principal = true AND s.deleted_at IS NULL;

-- ========================================
-- 3. NOT NULL (salvo users.sucursal_id, que admite NULL para ADMIN)
-- ========================================

ALTER TABLE ordenes_servicio ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE ventas           ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE sesiones_caja    ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE movimientos_caja ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE depositos        ALTER COLUMN sucursal_id SET NOT NULL;
-- users.sucursal_id: NO se aplica NOT NULL (ADMIN = NULL).

-- ========================================
-- 4. ÍNDICES COMPUESTOS (espejo de los (organization_id, ...) existentes)
-- ========================================

CREATE INDEX IF NOT EXISTS ordenes_org_sucursal_fecha_idx
  ON ordenes_servicio(organization_id, sucursal_id, fecha_ingreso);
CREATE INDEX IF NOT EXISTS ventas_org_sucursal_idx
  ON ventas(organization_id, sucursal_id);
CREATE INDEX IF NOT EXISTS sesiones_caja_org_sucursal_estado_idx
  ON sesiones_caja(organization_id, sucursal_id, estado);
CREATE INDEX IF NOT EXISTS movimientos_caja_org_sucursal_idx
  ON movimientos_caja(organization_id, sucursal_id);
CREATE INDEX IF NOT EXISTS depositos_org_sucursal_idx
  ON depositos(organization_id, sucursal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_org_sucursal_idx
  ON users(organization_id, sucursal_id);
```

- [ ] **Step 2: Aplicar en el SQL Editor de Supabase**

Pegar el contenido completo de `202_sucursales_scope_columns.sql` en el SQL Editor y ejecutar.
Esperado: sin errores. Si un `ALTER ... SET NOT NULL` falla con `column "sucursal_id" contains null values`, significa que existe una org sin Casa Central (Task 1 no corrió para esa org) o una fila huérfana sin `organization_id` válido — investigar con la query del Step 4 antes de continuar.

- [ ] **Step 3: Verificar — sin nulos en tablas operativas**

```sql
SELECT
  (SELECT COUNT(*) FROM ordenes_servicio WHERE sucursal_id IS NULL) AS ordenes_null,
  (SELECT COUNT(*) FROM ventas WHERE sucursal_id IS NULL) AS ventas_null,
  (SELECT COUNT(*) FROM sesiones_caja WHERE sucursal_id IS NULL) AS caja_null,
  (SELECT COUNT(*) FROM movimientos_caja WHERE sucursal_id IS NULL) AS mov_caja_null,
  (SELECT COUNT(*) FROM depositos WHERE sucursal_id IS NULL) AS depositos_null;
```

Esperado: las 5 columnas en `0`.

- [ ] **Step 4: Verificar — users ADMIN en NULL, resto asignados**

```sql
SELECT rol, COUNT(*) AS total, COUNT(sucursal_id) AS con_sucursal
FROM users
GROUP BY rol;
```

Esperado: para `ADMIN`, `con_sucursal` puede ser 0 (todos NULL); para `TECNICO` y `VENDEDOR`, `con_sucursal == total` (ninguno NULL).

- [ ] **Step 5: Verificar — coherencia org↔sucursal (ninguna fila apunta a sucursal de otra org)**

```sql
SELECT COUNT(*) AS cross_org_leaks
FROM ordenes_servicio o
JOIN sucursales s ON s.id = o.sucursal_id
WHERE s.organization_id <> o.organization_id;
```

Esperado: `0`. (Repetir mentalmente para ventas/caja si se desea; el backfill garantiza el match por construcción.)

- [ ] **Step 6: Verificar idempotencia**

Re-ejecutar el contenido completo de `202_sucursales_scope_columns.sql`.
Esperado: sin errores (los `ADD COLUMN IF NOT EXISTS` y `SET NOT NULL` ya aplicados son no-op; los `UPDATE ... WHERE sucursal_id IS NULL` no tocan filas).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202_sucursales_scope_columns.sql
git commit -m "feat(sucursales): sucursal_id en ordenes/ventas/caja/depositos/users + backfill"
```

---

### Task 3: Enum del plan PRO (migración aislada)

**Files:**
- Create: `supabase/migrations/203_plan_pro_enum.sql`

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/203_plan_pro_enum.sql` con este contenido exacto:

```sql
-- ========================================
-- 203: PLAN PRO — agregar value al enum plan_type
-- ========================================
-- DEBE ir en migración separada de su uso (204): Postgres no permite usar
-- un value de enum recién agregado dentro de la misma transacción.
-- IF NOT EXISTS hace la operación idempotente (Postgres 12+).

ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'PRO';
```

- [ ] **Step 2: Aplicar en el SQL Editor de Supabase**

Pegar y ejecutar `203_plan_pro_enum.sql`.
Esperado: "Success. No rows returned".

- [ ] **Step 3: Verificar — el value existe en el enum**

```sql
SELECT enumlabel
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'plan_type'
ORDER BY e.enumsortorder;
```

Esperado: lista incluye `FREE`, `PREMIUM`, `PRO`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/203_plan_pro_enum.sql
git commit -m "feat(planes): agrega value PRO al enum plan_type"
```

---

### Task 4: Datos del plan PRO + `limite_sucursales` + usage + gate

**Files:**
- Create: `supabase/migrations/204_plan_sucursales.sql`

> **IMPORTANTE:** Ejecutar Task 3 (203) y confirmar éxito ANTES de aplicar esta migración. El value `'PRO'` debe estar committeado en el enum para poder insertarse acá.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/204_plan_sucursales.sql` con este contenido exacto:

```sql
-- ========================================
-- 204: PLAN SUCURSALES — limite_sucursales, fila PRO, usage, gate
-- ========================================
-- Requiere que 203 (enum 'PRO') ya esté aplicado.
-- Idempotente: ADD COLUMN IF NOT EXISTS, UPDATE por tipo, INSERT por NOT EXISTS.

-- ========================================
-- 1. limite_sucursales en plans (NULL = ilimitado)
-- ========================================

ALTER TABLE plans ADD COLUMN IF NOT EXISTS limite_sucursales INTEGER;

UPDATE plans SET limite_sucursales = 1 WHERE tipo = 'FREE';
UPDATE plans SET limite_sucursales = 3 WHERE tipo = 'PREMIUM';

-- ========================================
-- 2. Fila del plan PRO (sucursales ilimitadas)
-- ========================================
-- NOTA DE NEGOCIO: precio y features son valores iniciales sugeridos.
-- Ajustar precio_mensual / precio_anual / features / stripe_price_* antes de
-- exponer el plan en producción. ~1.8x Profesional como ancla.

INSERT INTO plans (
  nombre, tipo, descripcion,
  precio_mensual, precio_anual, moneda,
  limite_ordenes, limite_tecnicos, limite_clientes, limite_storage_mb,
  limite_sucursales, features, activo
)
SELECT
  'Pro', 'PRO', 'Plan para cadenas con múltiples sucursales',
  34999, 335990, 'ARS',
  NULL, NULL, NULL, 10000,
  NULL,
  '["Todo lo de Profesional", "Sucursales ilimitadas", "Reportes consolidados por sucursal", "10GB almacenamiento", "Soporte prioritario"]',
  true
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE tipo = 'PRO');

-- ========================================
-- 3. organization_usage.sucursales_count (display/dashboard)
-- ========================================

ALTER TABLE organization_usage ADD COLUMN IF NOT EXISTS sucursales_count INTEGER DEFAULT 0;

UPDATE organization_usage ou
SET sucursales_count = (
  SELECT COUNT(*) FROM sucursales s
  WHERE s.organization_id = ou.organization_id
    AND s.deleted_at IS NULL
    AND s.activo = true
);

-- ========================================
-- 4. check_plan_limit extendido con 'sucursales'
-- ========================================
-- Para 'sucursales' usamos un COUNT en vivo (autoritativo, sin drift del
-- contador cacheado). El resto de los limit_type siguen leyendo de
-- organization_usage como antes.

CREATE OR REPLACE FUNCTION check_plan_limit(
  org_id TEXT,
  limit_type TEXT -- 'ordenes', 'tecnicos', 'clientes', 'sucursales'
)
RETURNS BOOLEAN AS $$
DECLARE
  plan_limit INTEGER;
  current_usage INTEGER;
BEGIN
  SELECT
    CASE limit_type
      WHEN 'ordenes' THEN p.limite_ordenes
      WHEN 'tecnicos' THEN p.limite_tecnicos
      WHEN 'clientes' THEN p.limite_clientes
      WHEN 'sucursales' THEN p.limite_sucursales
    END
  INTO plan_limit
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.organization_id = org_id
    AND s.status IN ('ACTIVE', 'TRIALING');

  -- Sin límite (NULL) o sin suscripción encontrada => permitir
  IF plan_limit IS NULL THEN
    RETURN TRUE;
  END IF;

  IF limit_type = 'sucursales' THEN
    SELECT COUNT(*) INTO current_usage
    FROM sucursales
    WHERE organization_id = org_id
      AND deleted_at IS NULL
      AND activo = true;
  ELSE
    SELECT
      CASE limit_type
        WHEN 'ordenes' THEN ordenes_mes_actual
        WHEN 'tecnicos' THEN tecnicos_count
        WHEN 'clientes' THEN clientes_count
      END
    INTO current_usage
    FROM organization_usage
    WHERE organization_id = org_id;
  END IF;

  IF current_usage IS NULL THEN
    current_usage := 0;
  END IF;

  RETURN current_usage < plan_limit;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Aplicar en el SQL Editor de Supabase**

Pegar y ejecutar `204_plan_sucursales.sql`.
Esperado: sin errores.

- [ ] **Step 3: Verificar — límites por tier**

```sql
SELECT tipo, limite_sucursales FROM plans ORDER BY tipo;
```

Esperado: `FREE → 1`, `PREMIUM → 3`, `PRO → NULL`.

- [ ] **Step 4: Verificar — la función gatea correctamente**

```sql
-- Tomar una org real con plan FREE y ver el resultado del gate.
-- Una org FREE con su Casa Central (1 sucursal) ya está EN el límite:
-- crear la 2da debe estar bloqueado => check_plan_limit devuelve FALSE.
SELECT o.id,
       p.tipo,
       check_plan_limit(o.id, 'sucursales') AS puede_crear_otra
FROM organizations o
JOIN subscriptions s ON s.organization_id = o.id
JOIN plans p ON p.id = s.plan_id
WHERE s.status IN ('ACTIVE','TRIALING')
LIMIT 10;
```

Esperado: para orgs FREE con 1 sucursal (su Casa Central), `puede_crear_otra = false`. Para orgs PRO, `true`. Para PREMIUM con <3 sucursales, `true`.

- [ ] **Step 5: Verificar idempotencia**

Re-ejecutar el contenido completo de `204_plan_sucursales.sql`.
Esperado: sin errores; `SELECT COUNT(*) FROM plans WHERE tipo='PRO'` sigue devolviendo `1` (no se duplica la fila PRO).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/204_plan_sucursales.sql
git commit -m "feat(planes): limite_sucursales por tier, fila PRO y gate en check_plan_limit"
```

---

## Self-Review

**Cobertura del spec (Sección 1 datos + Sección 2 migración):**
- Tabla `sucursales` con `principal`/soft-delete/índices/RLS/trigger → Task 1. ✓
- `sucursal_id` en ordenes/ventas/caja/movimientos_caja/depositos/users → Task 2. ✓
- `users.sucursal_id` nullable (ADMIN=NULL) → Task 2 Step 3-4. ✓
- Backfill Casa Central idempotente → Task 1. ✓
- Backfill data existente → Casa Central → Task 2. ✓
- `NOT NULL` salvo users → Task 2 Step 1 (sección 3 del SQL). ✓
- Índices compuestos espejo → Task 2 Step 1 (sección 4). ✓
- `ALTER TYPE ADD VALUE 'PRO'` en migración separada → Task 3. ✓
- `plans.limite_sucursales` FREE=1/PREMIUM=3/PRO=NULL → Task 4. ✓
- Fila plan PRO → Task 4. ✓
- `organization_usage.sucursales_count` + backfill → Task 4. ✓
- `check_plan_limit` extendido con 'sucursales' → Task 4. ✓
- Reversibilidad / idempotencia → cada Task tiene step de re-ejecución. ✓

**Fuera de esta fase (van en Fase 2-4, NO en este plan):** sesión JWT con `sucursalId`, helper `lib/sucursal.ts`, switcher, ABM UI, enforcement en queries de app, price IDs Stripe/MP reales, pricing landing. Correcto según rollout del spec.

**Placeholders:** el precio de PRO (34999/335990) es un valor inicial concreto y ajustable, marcado como decisión de negocio — no es un TBD que bloquee la ejecución de la migración. Sin otros placeholders.

**Consistencia de tipos/nombres:** columna `sucursal_id TEXT` consistente en las 6 tablas; `sucursales.principal`/`deleted_at`/`activo` usados igual en Tasks 1, 2 y 4; `check_plan_limit(org_id TEXT, limit_type TEXT)` mantiene la firma original de migración 006. ✓

## Notas para Fase 2 (no ejecutar ahora)

Tras aplicar Fase 1 en staging y verificar, la Fase 2 (app-layer) agregará: `sucursal_id` al select de `users` en `lib/auth.ts` + token/session, cookie `stapp-sucursal-activa`, y `lib/sucursal.ts` (`getSucursalContext` / `resolveSucursalFiltro` / `assertSucursalEnOrg`). Se planeará por separado tras explorar esos archivos.
