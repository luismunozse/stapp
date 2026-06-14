# Sistema de Sucursales por Organización — Diseño

**Fecha:** 2026-06-02
**Estado:** Aprobado (brainstorming) — pendiente plan de implementación
**Branch base:** `main`

## Resumen

Introducir el concepto de **sucursal** (branch/local físico) dentro de cada organización
del SaaS. Hoy el aislamiento es por `organization_id`; este sistema agrega un segundo nivel
de segmentación, `sucursal_id`, sobre las entidades operativas (órdenes, ventas, caja,
depósitos y usuarios), manteniendo el comportamiento actual para organizaciones de una
sola sucursal.

El enforcement es **app-layer** (espejo del patrón `organization_id` actual con service-role),
no RLS. Multi-sucursal es feature de planes pagos, monetizado vía tiers (Free / Profesional /
Pro), sin billing medido.

## Decisiones tomadas

| Tema | Decisión |
|------|----------|
| Alcance de segmentación | Órdenes de servicio, Ventas + Caja (POS), Inventario/depósitos, Usuarios |
| Modelo de acceso | ADMIN ve y opera todas (switcher); TECNICO/VENDEDOR fijos a 1 sucursal |
| Numeración órdenes/ventas | Sigue **correlativa por org** (sin cambio en contadores); sucursal es etiqueta/filtro |
| Gating por plan | Premium feature, límite configurable vía `plans.limite_sucursales` |
| Relación sucursal↔depósito | Sucursal tiene N depósitos (`depositos.sucursal_id`) |
| Enforcement | App-layer: `sucursal_id` en tablas + filtro en queries service-role |
| Estructura de planes | Tiers puros: Free=1, Profesional=3, **Pro (nuevo)=ilimitado** |
| Modelo de cobro | Sin add-on por unidad (MercadoPago no soporta billing medido de forma robusta) |

## Contexto del codebase

- **Multi-tenant**: `organization_id` en toda tabla operativa. Aislamiento real en
  **app-layer** vía `supabaseAdmin` (service-role) filtrando por `organization_id` en queries.
  RLS existe en migraciones nuevas (`current_setting('app.organization_id')`) pero es
  inconsistente y el grueso del código bypasea RLS con service-role.
- **Sesión**: NextAuth JWT (`lib/auth.ts`) lleva `organizationId`, `role`, `id`,
  `isSuperadmin`, `avatar`. Roles: `ADMIN | TECNICO | VENDEDOR`.
- **Tenant por subdominio**: `lib/tenant.ts` resuelve org desde subdominio (header
  `x-tenant-slug` seteado por middleware).
- **`depositos`** (migración 169 `multi_deposito`): catálogo de bodegas por org, con
  `principal`, soft-delete (`deleted_at`), índices parciales únicos, RLS, y RPC
  `transferir_stock_atomic`. **Es el molde a copiar para `sucursales`.**
- **Planes**: enum `plan_type = ('FREE','PREMIUM')`. PREMIUM se muestra como "Profesional"
  ($19.999 ARS/mes). Tabla `plans` con columnas `limite_*`, función `check_plan_limit`,
  `organization_usage` con contadores. Billing vía Stripe + MercadoPago (preapproval de
  monto fijo — sin cantidad/medido).

## Arquitectura

### 1. Modelo de datos

**Nueva tabla `sucursales`** (molde de `depositos`):

```sql
CREATE TABLE sucursales (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  codigo TEXT,                 -- ej. "CENTRO" para UI/prefijos
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
CREATE UNIQUE INDEX sucursales_org_nombre_unique
  ON sucursales(organization_id, LOWER(nombre)) WHERE deleted_at IS NULL;

-- Solo 1 principal por org
CREATE UNIQUE INDEX sucursales_org_principal_unique
  ON sucursales(organization_id) WHERE principal = true AND deleted_at IS NULL;

CREATE INDEX sucursales_org_idx ON sucursales(organization_id) WHERE deleted_at IS NULL;
```

RLS: `select` por org (`organization_id = current_setting('app.organization_id', true)`),
`all` para service-role (`USING (true) WITH CHECK (true)`). Trigger `updated_at`.

**Columna `sucursal_id` agregada** (todas `REFERENCES sucursales(id)`):

| Tabla | Nullability final | Nota |
|-------|-------------------|------|
| `ordenes_servicio` | NOT NULL | |
| `ventas` | NOT NULL | |
| `sesiones_caja` | NOT NULL | |
| `movimientos_caja` | NOT NULL | |
| `depositos` | NOT NULL | sucursal 1:N depósitos |
| `users` | **NULLABLE** | NULL = ADMIN (ve todas); valor fijo para TECNICO/VENDEDOR |

Índices compuestos: espejo de los `(organization_id, ...)` existentes en
`ordenes_servicio`, `ventas`, `sesiones_caja`, agregando `sucursal_id` para que los
listados filtrados por sucursal rindan.

**Planes (3 tiers):**

- `ALTER TYPE plan_type ADD VALUE 'PRO';` (en migración separada — Postgres no permite
  usar el value nuevo en la misma transacción que lo agrega).
- `ALTER TABLE plans ADD COLUMN limite_sucursales INTEGER;` (NULL = ilimitado).
  - FREE = 1, PREMIUM (Profesional) = 3, PRO = NULL.
- INSERT fila `plans` para PRO: precio mensual/anual, `stripe_price_*`, features/perks.
  **(Números de precio y perks: a definir por el negocio.)**
- `ALTER TABLE organization_usage ADD COLUMN sucursales_count INTEGER DEFAULT 0;` + backfill.
- Reusar `check_plan_limit` extendiendo `limit_type` con `'sucursales'`.

### 2. Migración y backfill (idempotente, espejo de migración 169)

Orden de operaciones:

1. Crear tabla `sucursales` + índices + RLS + trigger.
2. **Backfill "Casa Central"**: cada org sin sucursal principal → insertar 1 sucursal
   `principal=true, activo=true, nombre='Casa Central'`. Idempotente vía `WHERE NOT EXISTS`.
3. Agregar columnas `sucursal_id` (todas nullable primero).
4. **Backfill datos existentes** → cada fila apunta a la Casa Central de su org:
   `ordenes_servicio`, `ventas`, `sesiones_caja`, `movimientos_caja`, `depositos`, `users`.
   El depósito `Principal` existente (mig 169) queda colgado de Casa Central.
5. Aplicar `NOT NULL` en todas salvo `users.sucursal_id`.
6. Planes: enum PRO (migración separada) → `limite_sucursales` → UPDATE FREE/PREMIUM →
   INSERT PRO → `organization_usage.sucursales_count` + backfill count.

**Punto fino Postgres**: `ALTER TYPE ... ADD VALUE` no puede usarse en la misma transacción
en que se referencia el value nuevo. ⇒ **2 migraciones separadas**: una agrega el enum,
la siguiente lo usa (INSERT fila PRO, UPDATE).

**Reversibilidad**: backfill no destruye datos; columnas nuevas nullable→notnull.
Rollback = drop columns + drop tabla `sucursales`.

### 3. App-layer: sesión, contexto y enforcement

**Sesión (JWT, `lib/auth.ts`)**:
- Agregar `sucursalId` a token + session (de `users.sucursal_id`). Fijo para
  TECNICO/VENDEDOR, NULL para ADMIN.
- Las queries de `authorize()` suman `sucursal_id` al select de `users`.

**Sucursal activa (ADMIN)** — ADMIN ve todas, opera de a una vía switcher:
- Selección activa en **cookie** `stapp-sucursal-activa` (no en JWT — cambia sin re-firmar
  token).
- Default ADMIN: Casa Central (principal). También opción "Todas las sucursales".
- TECNICO/VENDEDOR: la cookie se ignora, siempre su `sucursalId` de sesión.

**Helper central de scoping** — nuevo `lib/sucursal.ts`:
```ts
getSucursalContext() → { sucursalId: string | null, esAdmin: boolean, verTodas: boolean }
resolveSucursalFiltro(ctx) // aplica filtro a query builder
assertSucursalEnOrg(sucursalId, orgId) // valida pertenencia, rechaza cross-org
```
- TECNICO/VENDEDOR → `eq('sucursal_id', ctx.sucursalId)`.
- ADMIN con sucursal activa → `eq('sucursal_id', activa)`.
- ADMIN "ver todas" → sin filtro de sucursal (solo `organization_id`).

**Escritura** — al crear orden/venta/sesión de caja: `sucursal_id` se toma del contexto
server-side (`getSucursalContext`), **nunca del body del cliente**. ADMIN en "Todas" debe
elegir sucursal destino explícitamente antes de crear.

**Validación cruzada** — `assertSucursalEnOrg` previene inyección de una sucursal de otra
org (mismo vector que `organization_id` hoy).

**Superficie de cambio** — APIs/queries de: órdenes, ventas, caja, inventario (depósitos
por sucursal), reportes y dashboard. Todas pasan por el helper en lugar de filtros ad-hoc.

### 4. UI / UX

- **Switcher de sucursal (ADMIN)** en navbar: dropdown con sucursales activas + "Todas las
  sucursales". Setea cookie y refresca data. Solo visible para ADMIN.
  TECNICO/VENDEDOR ven un badge fijo no editable con su sucursal.
- **ABM Sucursales** en `app/(dashboard)/configuracion/sucursales/`: lista (nombre, código,
  dirección, activo, principal), crear/editar/soft-delete. No se borra la principal; no se
  borra una sucursal con datos (se desactiva). Botón "Nueva sucursal" con **gate por plan**:
  si `sucursales_count >= limite_sucursales` → modal upsell ("Subí a Pro para ilimitadas").
- **Asignación de usuario**: en alta/edición de TECNICO/VENDEDOR, selector de sucursal
  obligatorio. ADMIN: campo deshabilitado / "Todas".
- **Depósitos**: editor suma selector de sucursal (1:N). Transferencias (mig 169) ya operan
  cross-depósito; la UI muestra la sucursal de cada depósito.
- **Indicadores de scope**: listados de órdenes/ventas/caja muestran columna/badge de
  sucursal cuando ADMIN está en "Todas". Reportes/dashboard respetan la sucursal activa.

### 5. Testing y rollout

**Tests (vitest, `__tests__/api/`):**
- Migración/backfill: cada org recibe Casa Central; filas viejas apuntan a la principal;
  counts correctos.
- Scoping: TECNICO solo ve su sucursal; ADMIN "todas" ve todo; ADMIN con activa filtra;
  fuga cross-sucursal bloqueada.
- Cross-org: `assertSucursalEnOrg` rechaza sucursal de otra org.
- Plan gate: FREE rechaza 2da sucursal; PROFESIONAL rechaza 4ta; PRO ilimitado.
- Escritura: orden/venta nace con `sucursal_id` correcto; cliente no puede inyectar otra.
- Caja: cierre aislado por sucursal.

**E2E (playwright):** switcher cambia data; técnico no ve switcher; ABM crea/desactiva.

**Rollout por fases:**
1. Migración de datos (Casa Central + backfill). Prod sin cambio funcional — todo en 1
   sucursal, comportamiento idéntico.
2. App-layer (helper + sesión). Sin UI. Verificar no-regresión.
3. UI: ABM + switcher + asignación de usuario.
4. Plan PRO (enum, fila, precios, price IDs, pricing en landing). Paralelo o posterior.

**Compatibilidad**: una org de una sola sucursal se comporta idéntico al sistema actual.
La feature es invisible hasta crear la 2da sucursal.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Query que olvida el filtro de sucursal → fuga entre sucursales | Helper central `lib/sucursal.ts` único punto de filtrado + tests de scoping |
| Inyección de sucursal de otra org | `assertSucursalEnOrg` en toda escritura |
| `ALTER TYPE ADD VALUE` en misma tx | Dividir en 2 migraciones |
| Billing medido frágil en MercadoPago | Modelo de tiers puros, sin add-on por unidad |
| Backfill rompe datos existentes | Idempotente, nullable→notnull, todo a Casa Central |

## Fuera de alcance (YAGNI)

- Numeración correlativa por sucursal / prefijos de sucursal en números.
- Usuario perteneciente a múltiples sucursales (N:M).
- Add-on / billing medido por sucursal extra.
- RLS por `app.sucursal_id`.
- Stock compartido cross-sucursal automático (las transferencias ya cubren el movimiento manual).
