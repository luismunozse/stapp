# Plan: Sistema de 3 Planes con Efecto Anclaje

## Contexto

La landing actual muestra un solo plan "Premium" sin referencia de valor. Esto elimina el efecto anclaje psicológico que en SaaS genera conversiones significativamente mayores cuando el usuario ve 2-3 opciones donde la del medio es "la obvia".

**Problema adicional:** El trial de 30 días da acceso completo a PREMIUM. Si un usuario baja a un plan inferior después del trial, pierde funciones que ya usó. Hay que diseñar el sistema para que esto sea una ventaja (motivar upgrade) y no una frustración.

**Estado actual del sistema:**
- `plan_type` ENUM: solo `FREE` y `PREMIUM`
- Constraint `UNIQUE` en `plans.tipo` — solo puede existir 1 row por tipo
- Trial: crea subscription con `plan_id` = PREMIUM, status = `TRIALING`, 30 días
- Feature gating: `isPremium()` binario (12 archivos API lo usan), `enforcePlanLimit()` ya lee límites de la row del plan
- Pagos: MercadoPago/Rebill hardcodean el plan PREMIUM

---

## Decisiones de Diseño

### 1. NO agregar nuevos valores al ENUM `plan_type`
Agregar valores requiere `ALTER TYPE` + quitar el constraint UNIQUE + actualizar 25+ archivos que hacen `planTipo === "PREMIUM"`. Es frágil y alto riesgo.

**En su lugar:** Quitar el constraint UNIQUE de `plans.tipo`, crear 3 rows todas con `tipo = 'PREMIUM'`, y diferenciar por un nuevo campo `slug`. Los chequeos `isPremium()` siguen funcionando porque los 3 planes pagos son `tipo = 'PREMIUM'`.

### 2. Trial se queda en plan Profesional
Mínimo cambio: `create_free_subscription()` selecciona por `slug = 'profesional'` en vez de `tipo = 'PREMIUM' LIMIT 1`. El usuario experimenta todo durante 30 días, luego elige tier.

### 3. Feature gating granular con `feature_flags` JSONB
Reemplazar el chequeo binario `isPremium()` en rutas específicas por `hasPlanFeature(orgId, 'feature_key')` que lee un campo JSONB del plan. Así Emprendedor puede tener algunas features bloqueadas sin tocar el tipo de plan.

### 4. Taller+ es "Contactar Ventas" (no plan real por ahora)
Reduce complejidad. Funciona como ancla de precio visual. Se puede convertir en plan real más adelante.

---

## Fases de Implementación

### Fase 1: Migración de Base de Datos
**Archivo:** `supabase/migrations/102_three_tier_plans.sql`

```sql
-- 1. Quitar constraint UNIQUE de tipo
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_tipo_key;

-- 2. Agregar campos nuevos
ALTER TABLE plans ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS tier_order INTEGER DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}';

-- 3. Actualizar plan FREE existente
UPDATE plans SET slug = 'free', tier_order = 0,
  feature_flags = '{}' WHERE tipo = 'FREE';

-- 4. Actualizar plan PREMIUM existente → ahora es "Profesional"
UPDATE plans SET
  slug = 'profesional', tier_order = 2, nombre = 'Profesional',
  feature_flags = '{
    "advanced_reports": true, "whatsapp_notifications": true,
    "kiosk_mode": true, "pos_sales": true, "client_portal": true,
    "data_export": true, "custom_logo": true, "cuenta_corriente": true,
    "cotizaciones_online": true, "gestion_proveedores": true,
    "import_export": true, "firma_digital": true, "fotos_etapa": true,
    "garantias": true
  }'
WHERE tipo = 'PREMIUM';

-- 5. Insertar plan Emprendedor
INSERT INTO plans (nombre, tipo, slug, tier_order, descripcion,
  precio_mensual, precio_anual, precio_mensual_usd, precio_anual_usd,
  limite_ordenes, limite_tecnicos, limite_clientes, limite_vendedores,
  limite_storage_mb, feature_flags, features, activo)
VALUES (
  'Emprendedor', 'PREMIUM', 'emprendedor', 1,
  'Para talleres que recién arrancan',
  10999, 105590,  -- ~55% de Profesional
  8, 77,
  30, 1, NULL, 2, 1000,
  '{"pos_sales": true, "fotos_etapa": true, "garantias": true,
    "firma_digital": true, "cuenta_corriente": true}',
  '["Hasta 30 órdenes/mes","1 técnico","2 vendedores",
    "Clientes ilimitados","1GB almacenamiento","Soporte por email",
    "Punto de venta","Firma digital","Garantías"]',
  TRUE
);

-- 6. Actualizar función de trial para seleccionar por slug
CREATE OR REPLACE FUNCTION create_free_subscription(org_id TEXT)
RETURNS TEXT AS $$
DECLARE
  target_plan_id TEXT;
  new_sub_id TEXT;
BEGIN
  SELECT id INTO target_plan_id FROM plans WHERE slug = 'profesional' AND activo = TRUE LIMIT 1;
  IF target_plan_id IS NULL THEN
    SELECT id INTO target_plan_id FROM plans WHERE tipo = 'PREMIUM' AND activo = TRUE LIMIT 1;
  END IF;
  IF target_plan_id IS NULL THEN
    RAISE EXCEPTION 'No plan found';
  END IF;

  INSERT INTO subscriptions (organization_id, plan_id, status,
    current_period_start, current_period_end, trial_end)
  VALUES (org_id, target_plan_id, 'TRIALING', NOW(),
    NOW() + INTERVAL '30 days', NOW() + INTERVAL '30 days')
  RETURNING id INTO new_sub_id;

  INSERT INTO organization_usage (organization_id) VALUES (org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN new_sub_id;
END;
$$ LANGUAGE plpgsql;
```

**Compatibilidad:** Suscripciones existentes apuntan al plan PREMIUM, que ahora se llama "Profesional" — sin migración de datos.

---

### Fase 2: Core Libraries

**`lib/subscriptions.ts`:**
- Agregar `planSlug` al interface `SubscriptionInfo` y al SELECT query
- Nueva función `hasPlanFeature(orgId, featureKey)` → lee `feature_flags` JSONB del plan
- Nueva función `getPlanSlug(orgId)` → retorna el slug del plan actual
- Actualizar mensaje en `checkPlanLimit()`: "Actualiza tu plan" en vez de "Actualiza a Premium"

**`lib/pricing.ts`:**
- Nueva función `getAllPlanPrices()` que retorna precios de todos los planes activos indexados por slug
- Mantener `getPremiumPrices()` como wrapper que retorna precios de `profesional`

**`lib/plan-limits.ts`:**
- Mensajes de error deben ser dinámicos: "Actualiza a Profesional" para Emprendedor

**`hooks/use-subscription.ts`:**
- Agregar `planSlug` al hook return
- Nuevo hook `useHasFeature(featureKey)` para feature gating en UI

---

### Fase 3: Feature Gating (12 archivos API)

Reemplazar `isPremium()` por `hasPlanFeature()` en:

| Archivo | Feature Key |
|---------|------------|
| `app/api/reportes/fallas-comunes/route.ts` | `advanced_reports` |
| `app/api/reportes/tiempo-reparacion/route.ts` | `advanced_reports` |
| `app/api/reportes/prediccion-repuestos/route.ts` | `advanced_reports` |
| `app/api/reportes/tasa-retorno/route.ts` | `advanced_reports` |
| `app/api/reportes/rentabilidad/route.ts` | `advanced_reports` |
| `app/api/whatsapp/send/route.ts` | `whatsapp_notifications` |
| `app/api/whatsapp/config/route.ts` | `whatsapp_notifications` |
| `app/api/whatsapp/test/route.ts` | `whatsapp_notifications` |
| `app/api/kiosco/route.ts` | `kiosk_mode` |
| `app/api/export/[entity]/route.ts` | `data_export` |
| `app/api/export/reportes/route.ts` | `data_export` |

`app/api/subscription/status/route.ts` mantiene `isPremium()` porque es informacional.

---

### Fase 4: Flujo de Pago

**`lib/mercadopago.ts`:**
- `createPaymentPreference()` recibe `planId`, busca precios del plan específico
- Incluir `plan_id` en `external_reference`

**`app/api/mercadopago/preference/route.ts`:**
- Aceptar `planSlug` o `planId` en el body
- Buscar plan y sus precios, pasar a `createPaymentPreference()`

**`app/api/mercadopago/webhook/route.ts`:**
- Leer `plan_id` desde `external_reference` en vez de hardcodear `tipo = 'PREMIUM'`
- Fallback: si no hay `plan_id` en reference (pagos viejos), usar plan `profesional`

---

### Fase 5: UI

**`components/landing/pricing-section.tsx`** (ya tiene 3-tier UI):
- Reemplazar `priceMultiplier` por precios reales de la API
- CTAs linkan a `/registro?plan=emprendedor|profesional`

**`components/subscription/subscription-required-view.tsx`** (paywall post-trial):
- Transformar de 1 card a grid de 3 planes
- Cada plan con su CTA que abre `UpgradeModal` con el plan preseleccionado

**`components/billing/upgrade-modal.tsx`:**
- Aceptar `planId`/`planSlug` como prop
- Mostrar nombre y precio del plan seleccionado
- Pasar `planId` a la API de preference

**`components/subscription/trial-banner.tsx`:**
- Mensaje: "Estás probando el plan Profesional — te quedan X días"

**Dashboard UI para features bloqueadas (Emprendedor):**
- En reportes, WhatsApp, kiosco, export: mostrar estado "locked" con badge "Disponible en Profesional" en vez de ocultar

---

### Fase 6: Superadmin

**`app/api/superadmin/plans/route.ts`:**
- Quitar validación que impide crear 2 planes con mismo `tipo`
- Validar `slug` único en su lugar
- Agregar `slug`, `tier_order`, `feature_flags` al schema Zod

**`app/superadmin/planes/page.tsx`:**
- Mostrar/editar los campos nuevos

---

## Orden de Ejecución

| # | Fase | Riesgo | Esfuerzo |
|---|------|--------|----------|
| 1 | DB Migration (Fase 1) | Bajo — aditivo, no rompe nada | Chico |
| 2 | Core libraries (Fase 2) | Medio — lógica central | Medio |
| 3 | Feature gating (Fase 3) | Bajo — mecánico, 12 archivos | Medio |
| 4 | Flujo de pago (Fase 4) | Alto — toca dinero | Medio |
| 5 | UI landing + paywall (Fase 5) | Bajo | Medio |
| 6 | Superadmin (Fase 6) | Bajo | Chico |

## Planes y Features por Tier

| Feature | Emprendedor | Profesional | Taller+ (visual) |
|---------|:-----------:|:-----------:|:---------:|
| Órdenes/mes | 30 | Ilimitadas | Ilimitadas |
| Técnicos | 1 | Ilimitados | Ilimitados |
| Vendedores | 2 | Ilimitados | Ilimitados |
| Clientes | Ilimitados | Ilimitados | Ilimitados |
| Storage | 1GB | 5GB | 20GB |
| POS / Ventas | Si | Si | Si |
| Firma digital | Si | Si | Si |
| Garantías | Si | Si | Si |
| Cuenta corriente | Si | Si | Si |
| Portal seguimiento | No | Si | Si |
| Reportes avanzados | No | Si | Si |
| WhatsApp notif. | No | Si | Si |
| Modo kiosco | No | Si | Si |
| Export datos | No | Si | Si |
| Logo personalizado | No | Si | Si |
| Cotizaciones online | No | Si | Si |
| Gestión proveedores | No | Si | Si |
| Soporte dedicado | No | No | Si |
| Multi-sucursal | No | No | Próximamente |

## Rollback

Si algo sale mal:
1. El ENUM no se tocó → no hay `ALTER TYPE` que revertir
2. Desactivar rows de Emprendedor y Taller+ (`activo = false`)
3. Todas las suscripciones existentes siguen apuntando al mismo `plan_id` (ahora "Profesional")
4. `isPremium()` sigue funcionando porque todos los planes pagos son `tipo = 'PREMIUM'`

## Verificación

1. **DB:** Correr migración en Supabase local, verificar 3 rows en `plans` con slugs correctos
2. **Trial:** Registrar nuevo usuario, verificar que recibe plan `profesional` con trial 30 días
3. **Feature gating:** Con usuario en plan `emprendedor`, intentar acceder a reportes avanzados → 403
4. **Pago:** Crear preference de MercadoPago con `planSlug=emprendedor`, verificar precio correcto en checkout
5. **Webhook:** Simular pago completado, verificar que subscription se activa con el plan correcto
6. **Landing:** Verificar que los 3 planes muestran precios reales de la DB
7. **Paywall:** Expirar trial, verificar que muestra los 3 planes con CTAs funcionales

## Archivos Críticos

- `supabase/migrations/102_three_tier_plans.sql` (nuevo)
- `lib/subscriptions.ts` — agregar planSlug, hasPlanFeature(), getPlanSlug()
- `lib/pricing.ts` — getAllPlanPrices()
- `lib/plan-limits.ts` — mensajes dinámicos
- `hooks/use-subscription.ts` — planSlug + useHasFeature()
- `lib/mercadopago.ts` — aceptar planId
- `app/api/mercadopago/preference/route.ts` — aceptar planSlug
- `app/api/mercadopago/webhook/route.ts` — leer plan_id de external_reference
- `app/api/reportes/*/route.ts` (5 archivos) — hasPlanFeature('advanced_reports')
- `app/api/whatsapp/*/route.ts` (3 archivos) — hasPlanFeature('whatsapp_notifications')
- `app/api/kiosco/route.ts` — hasPlanFeature('kiosk_mode')
- `app/api/export/*/route.ts` (2 archivos) — hasPlanFeature('data_export')
- `components/landing/pricing-section.tsx` — precios reales de API
- `components/subscription/subscription-required-view.tsx` — 3-tier paywall
- `components/subscription/trial-banner.tsx` — mensaje con nombre de plan
- `app/api/superadmin/plans/route.ts` — quitar validación UNIQUE tipo

---

## ALERTA: Queries que ROMPEN con múltiples planes PREMIUM

La Fase 1 crea 2 rows con `tipo = 'PREMIUM'` (Emprendedor + Profesional). Hay **5 queries** en
el código que hacen `.eq("tipo", "PREMIUM").single()` — esto falla con error de Supabase cuando
`.single()` devuelve más de 1 resultado.

**REGLA: La Fase 1 (migración DB) NO se puede deployar sola. Debe ir junto con los fixes de estas
5 queries como un deploy atómico.**

### Query 1: Landing page — precios no cargan

**Archivo:** `lib/pricing.ts` línea 33-38
```typescript
const { data, error } = await supabaseAdmin
  .from("plans")
  .select("precio_mensual, precio_anual, precio_mensual_usd, precio_anual_usd")
  .eq("tipo", "PREMIUM")
  .eq("activo", true)
  .single()   // ← ROMPE: 2 rows PREMIUM activas
```
**Impacto:** La landing page no carga precios. `getPremiumPrices()` retorna fallback o error.
**Fix:** Cambiar a `.eq("slug", "profesional")` o implementar `getAllPlanPrices()` (Fase 2).

### Query 2: Webhook MercadoPago — pagos no se activan

**Archivo:** `app/api/mercadopago/webhook/route.ts` líneas 238-242
```typescript
const { data: premiumPlan, error: planError } = await supabaseAdmin
  .from("plans")
  .select("id")
  .eq("tipo", "PREMIUM")
  .single()   // ← ROMPE: 2 rows PREMIUM
```
**Impacto:** CRÍTICO — Cuando un usuario paga, el webhook falla y la suscripción NO se activa.
El pago se cobra pero el usuario queda bloqueado.
**Fix:** Leer `plan_id` desde `external_reference` del pago, con fallback a
`.eq("slug", "profesional")` para pagos anteriores (Fase 4).

### Query 3: Webhook Rebill — pagos internacionales no se activan

**Archivo:** `app/api/rebill/webhook/route.ts` líneas 210-214
```typescript
const { data: premiumPlan } = await supabaseAdmin
  .from("plans")
  .select("id")
  .eq("tipo", "PREMIUM")
  .single()   // ← ROMPE: 2 rows PREMIUM
```
**Impacto:** CRÍTICO — Mismo problema que MercadoPago pero para pagos internacionales.
**Fix:** Mismo approach: leer `plan_id` de metadata, fallback a `.eq("slug", "profesional")`.

### Query 4: Superadmin — renovación manual falla

**Archivo:** `app/api/superadmin/subscriptions/renew/route.ts` líneas 27-32
```typescript
const { data: premiumPlan, error: planError } = await supabaseAdmin
  .from("plans")
  .select("id, precio_mensual, precio_anual, moneda")
  .eq("tipo", "PREMIUM")
  .eq("activo", true)
  .single()   // ← ROMPE: 2 rows PREMIUM activas
```
**Impacto:** Superadmin no puede renovar suscripciones manualmente. Bloquea operación de soporte.
**Fix:** Aceptar `planId` como parámetro en el request, o default a `.eq("slug", "profesional")`.

### Query 5: Superadmin — activación bulk falla

**Archivo:** `app/api/superadmin/subscriptions/bulk/route.ts` líneas 82-87
```typescript
const { data: premiumPlan } = await supabaseAdmin
  .from("plans")
  .select("id")
  .eq("tipo", "PREMIUM")
  .eq("activo", true)
  .single()   // ← ROMPE: 2 rows PREMIUM activas
```
**Impacto:** Activación masiva de suscripciones desde superadmin falla.
**Fix:** Default a `.eq("slug", "profesional")` o recibir `planSlug` en el request.

### Queries que NO rompen (ya verificadas)

| Archivo | Línea | Por qué está OK |
|---------|-------|-----------------|
| `lib/subscriptions.ts` (`isPremium`) | 304 | Lee `subscription.planTipo` del JOIN, no query directo a plans |
| `lib/subscriptions.ts` (`checkPlanLimit`) | 148-171 | Lee `subscription.limits` del JOIN, no query directo |
| `lib/subscription-status.ts` | 31, 43 | Lee `sub.plans?.tipo` del JOIN con subscription |
| `hooks/use-subscription.ts` | — | Lee de `/api/subscription/status`, no query directo |
| `app/api/subscription/status/route.ts` | — | Usa `getSubscriptionInfo()` que hace JOIN |
| `app/api/superadmin/organizations/route.ts` | 34 | Usa como filtro de JOIN, devuelve múltiples rows (no `.single()`) |
| `app/api/superadmin/stats/route.ts` | 53 | Usa como filtro de conteo |
| `app/api/superadmin/stats/dashboard/route.ts` | 46 | Usa como filtro de conteo |
| `app/api/ordenes/route.ts` | 182 | Usa `enforcePlanLimit` → lee límites del plan via JOIN |
| `app/api/clientes/route.ts` | — | Mismo patrón que órdenes |
| `app/api/tecnicos/route.ts` | — | Mismo patrón que órdenes |

### Flujos que siguen funcionando sin cambios

- **Crear/editar órdenes** — `enforcePlanLimit()` lee límites via JOIN con la subscription existente
- **Crear clientes/técnicos/vendedores** — mismo patrón
- **Subir fotos** — `enforcePlanLimit("storage")` mismo patrón
- **Dashboard layout access check** — `hasValidAccess()` chequea status, no tipo de plan
- **Trial banner** — lee de `/api/subscription/status` que usa JOIN
- **Reportes/WhatsApp/Kiosco/Export** — `isPremium()` lee `planTipo` del JOIN (funciona porque Profesional tiene `tipo = 'PREMIUM'`)

---

## Estrategia de Deploy

### Recomendación: Deploy en fin de semana (ventana de bajo uso)

Dado que los fixes de las 5 queries y la migración DB deben ir juntos, y que 2 de las
queries rotas afectan **cobros** (webhook MP y Rebill), el deploy debe ser atómico y
en una ventana donde se pueda validar sin impacto en usuarios.

### Orden de deploy (todo en un solo release):

```
1. Mergear todos los cambios de código (Fases 2-6) a main
2. Correr migración DB en Supabase (Fase 1)
3. Deployar código a Vercel
4. Validar inmediatamente:
   a. Landing page carga precios ✓
   b. Crear usuario de test → recibe trial Profesional ✓
   c. Simular pago MP en sandbox → webhook activa suscripción ✓
   d. Superadmin puede renovar manualmente ✓
   e. Crear orden con usuario existente → funciona ✓
```

### Alternativa segura (deploy gradual):

Si se quiere reducir riesgo, las 5 queries se pueden fixear ANTES de la migración.
El fix es compatible hacia atrás:

```typescript
// ANTES (rompe con 2+ PREMIUM):
.eq("tipo", "PREMIUM").single()

// FIX COMPATIBLE (funciona con 1 o 2+ PREMIUM):
.eq("slug", "profesional").single()
// ↑ Si slug no existe aún (pre-migración), retorna null → cae en fallback
//   Si slug existe (post-migración), retorna el plan correcto

// ALTERNATIVA MÁS SEGURA:
.eq("tipo", "PREMIUM").eq("activo", true).order("tier_order", { ascending: false }).limit(1).single()
// ↑ Siempre devuelve el plan con mayor tier_order (Profesional > Emprendedor)
```

**Plan de 2 pasos:**
1. **Antes del finde:** Deployar SOLO los fixes de las 5 queries (usando `.eq("slug", "profesional")` con fallback). Esto es retrocompatible — si `slug` no existe, Supabase ignora el filtro y funciona como antes.
2. **Fin de semana:** Correr migración DB + deployar el resto (Fases 2-6).

> **Nota:** El fallback `.eq("slug", "profesional")` solo funciona si la columna `slug` ya existe en la tabla. Si la migración no se corrió, la query falla. Por eso la alternativa más segura es usar `.order("tier_order").limit(1)` como paso intermedio, o simplemente hacer todo junto el fin de semana.
