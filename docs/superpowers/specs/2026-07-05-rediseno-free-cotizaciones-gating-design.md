# Rediseño Free vs Profesional — gating de cotizaciones — Diseño

**Fecha:** 2026-07-05
**Estado:** Aprobado (diseño) — pendiente plan de implementación

## Problema

Usuarios que se quedan en Free y no migran a Profesional. Diagnóstico (evidencia en migraciones):

- La migración **187** (`187_free_plan_v2_loosen.sql`) aflojó el Free para bajar fricción (conversión era 0%): subió caps (15→30 órdenes, 30→200 clientes) y **metió en Free las features que eran el driver de upgrade**: `pos_sales`, `cotizaciones_online`, `client_portal`.
- Resultado: un taller chico (1 técnico, <30 órdenes/mes, <200 clientes) tiene el flujo de trabajo completo gratis y nunca choca una pared ni le falta una feature que empuje al pago. La escalera de valor se aplanó.
- Además, `client_portal` = link público de seguimiento de órdenes (`/seguimiento/[token]`), gratis para todos desde la migración **147** a propósito.

**Decisión de negocio (este cambio):** recrear un driver de upgrade **limpio y de bajo riesgo** moviendo **solo `cotizaciones_online`** de vuelta a Profesional. Se descarta mover `client_portal` (seguimiento) por su alto blast radius (feature de retención de larga data que rompería links compartidos de todos los Free). POS y seguimiento quedan en Free.

## Hallazgo técnico crítico

Los flags `cotizaciones_online` y `client_portal` **no están enforzados en el producto**. Solo aparecen en:
- `app/superadmin/planes/_components/plan-form.tsx` (labels del toggle superadmin)
- `lib/pricing.ts` (mapas de display)

Las rutas de cotizaciones (`app/api/cotizaciones/**`) y la UI **nunca chequean `hasPlanFeature(org, "cotizaciones_online")`**. Por lo tanto **apagar el flag en la DB no cambia el comportamiento**: este rediseño requiere **código de enforcement**, no solo una migración de datos.

El primitivo de gating ya existe: `hasPlanFeature(organizationId, featureKey)` en `lib/subscriptions.ts` (soporta overrides por org vía `organization_feature_overrides`, y ya niega acceso si el trial expiró o el período venció).

## Decisiones tomadas (brainstorming)

1. **Mover solo `cotizaciones_online` a Profesional.** POS, inventario, órdenes y seguimiento (`client_portal`) quedan en Free.
2. **Revocar a todos** los Free (no grandfather permanente), pero con **aviso previo (~14 días): banner in-app + email**.
3. **Caps sin cambio:** 30 órdenes/mes, 200 clientes, 1 técnico, 1 vendedor, 1 sucursal. El driver es la feature, no el volumen.
4. **Históricos read-only + close-out:** un Free tras el flip **puede ver** sus cotizaciones existentes (lista, PDF, historial), **aprobarlas y convertirlas** a orden/venta, pero **no puede crear, editar, enviar ni duplicar** cotizaciones nuevas.

## Estado actual (contexto)

- **Plan Free (real, mig. 187):** 30 órdenes/mes, 200 clientes, 1 téc/1 vend, 1 sucursal, 100MB. `feature_flags`: `pos_sales`, `cotizaciones_online`, `client_portal`.
- **Plan Profesional (~$19.999 ARS/mes):** todo (órdenes/clientes/técnicos ilimitados, 3 sucursales, 5GB) + todas las flags on. Trial 30 días full → cae a Free.
- **Landing (`components/landing/pricing-section.tsx`):** lista de features **hardcodeada y desincronizada** — muestra el Free viejo (pre-187): "15 órdenes, 30 clientes, sin POS, sin portal, sin cotizaciones". No refleja el producto real.
- **Rutas de cotizaciones:** `app/api/cotizaciones/route.ts` (POST crear, GET listar), `[id]/route.ts` (PUT editar, GET, DELETE), `[id]/enviar`, `[id]/duplicar`, `[id]/convertir-orden`, `[id]/convertir-venta`, `[id]/aprobar`, `[id]/historial`, `[id]/pdf`. Públicas: `app/api/public/cotizaciones/[token]/**` (cliente ve/aprueba/rechaza).
- **UI:** `components/cotizaciones/cotizacion-form.tsx`, `app/(dashboard)/cotizaciones/page.tsx`, `components/cotizaciones/cotizacion-list.tsx`. Hook cliente: `hooks/use-subscription.ts`.

## Arquitectura de la solución

### 1. Enforcement de `cotizaciones_online` (backend)

Guard al inicio de cada ruta que **crea o produce cotizaciones nuevas**, devolviendo 403
`{ error, code: "FEATURE_REQUIRED", feature: "cotizaciones_online" }` cuando
`hasPlanFeature(org, "cotizaciones_online")` es false (mismo shape que el gate de whatsapp/reportes):

| Ruta | Acción | ¿Gate? |
|---|---|---|
| `POST /api/cotizaciones` | crear | **SÍ** |
| `PUT /api/cotizaciones/[id]` | editar | **SÍ** |
| `POST /api/cotizaciones/[id]/enviar` | enviar al cliente | **SÍ** |
| `POST /api/cotizaciones/[id]/duplicar` | crear desde existente | **SÍ** |
| `GET /api/cotizaciones` (listar) | ver | NO (read-only) |
| `GET /api/cotizaciones/[id]`, `/historial`, `/pdf` | ver | NO |
| `POST /api/cotizaciones/[id]/aprobar` | cerrar existente | NO (close-out) |
| `POST /api/cotizaciones/[id]/convertir-orden`, `/convertir-venta` | cerrar existente → orden/venta (features Free) | NO (close-out) |
| `app/api/public/cotizaciones/[token]/**` | cliente ve/aprueba/rechaza una ya enviada | NO (no romper aprobaciones en curso) |

Regla: **gatear lo que genera cotizaciones nuevas; permitir ver/cerrar las existentes.** Esto materializa "históricos read-only + close-out" sin destruir datos ni dejar trabajo a medias.

### 2. Enforcement (UI)

- `app/(dashboard)/cotizaciones/page.tsx`: si el org no tiene la feature (vía `use-subscription`), ocultar/deshabilitar "Nueva cotización" y mostrar un banner "Las cotizaciones son parte de Profesional" con CTA a `/precios`. La lista existente se muestra en solo-lectura.
- Puntos de entrada a `cotizacion-form.tsx` (incl. crear-desde-cliente / crear-desde-orden): mismo gate. El backend 403 es la fuente de verdad; la UI solo evita el intento.
- Prompt contextual de upgrade (modal reutilizando `modal-context`) al intentar crear.

### 3. Migración de datos

`supabase/migrations/266_free_v3_cotizaciones_gating.sql`:

```sql
UPDATE plans SET
  feature_flags = feature_flags - 'cotizaciones_online',
  features = '["Hasta 30 órdenes/mes","1 técnico","1 vendedor","Hasta 200 clientes","100MB almacenamiento","Punto de venta (POS)","Portal de seguimiento cliente","Inventario básico","Soporte por email"]'::jsonb,
  updated_at = now()
WHERE slug = 'free';
```

Preserva `pos_sales` y `client_portal`. No toca precios, status ni suscripciones.

### 4. Sync del landing

`components/landing/pricing-section.tsx`: corregir la lista hardcodeada del Free para reflejar la realidad post-flip — Free **con** POS y seguimiento (hoy figuran como ✗ por error), caps reales (30 órdenes / 200 clientes), y **sin** cotizaciones online. Profesional mantiene "Cotizaciones con aprobación online" como diferencial.

### 5. Aviso de transición (rollout)

Secuencia de despliegue (desacopla deploy de revoke):
1. **Deploy del código de enforcement** con el flag **todavía TRUE** para Free → sin cambio de comportamiento.
2. **Aviso** a orgs Free con ≥1 cotización: banner in-app dismissible + email a admins (reusa `lib/email` / plantillas lifecycle) — "en 14 días las cotizaciones pasan a Profesional".
3. **Día del flip:** correr la migración 266 → el gating se activa.

## Manejo de errores / edge cases

- **Free intenta crear/enviar** → 403 `FEATURE_REQUIRED`; UI muestra upgrade CTA.
- **Cotizaciones en curso** (ya enviadas, esperando aprobación del cliente) → los links públicos siguen funcionando; el cliente puede aprobar/rechazar.
- **Override por org** (`organization_feature_overrides`) → respetado por `hasPlanFeature` (permite excepciones manuales, p.ej. dejarle la feature a un cliente puntual).
- **Trial activo** → tiene la feature (Profesional full) hasta que expira.
- **Feature "cotizar sin stock"** (recién agregada al form de creación) → queda gateada junto con el resto del create flow, sin quedar huérfana.

## Testing

- **Gating (integración):** org Free (sin `cotizaciones_online`) → 403 en POST `/api/cotizaciones`, PUT `[id]`, `enviar`, `duplicar`. Org con la feature (Pro/trial) → 200. Rutas de lectura (`GET` listar/`[id]`/`historial`/`pdf`) y close-out (`aprobar`, `convertir-*`) → 200 para Free. Override habilitado → 200.
- **Migración:** `cotizaciones_online` removido de `free.feature_flags`; `pos_sales` y `client_portal` preservados; `features` (texto) actualizado.
- **UI:** Free → sin botón "Nueva cotización", banner de upgrade, lista read-only. Pro → flujo completo.

## Qué NO tocamos (YAGNI)

- `client_portal` (seguimiento), `pos_sales` (POS) — quedan en Free.
- Caps de volumen, precios, status de planes, plan Pro (oculto), Emprendedor (inactivo).

## Riesgos

- **Churn de Free que usan cotizaciones** → mitigado con aviso previo de 14 días + históricos read-only + close-out (aprobar/convertir permitido).
- **Enforcement incompleto** (olvidar una ruta que crea cotizaciones) → la tabla de §1 es la checklist; el test de gating cubre las 4 rutas de escritura.

## Descomposición sugerida (para la fase de plan)

Probable entrega en 2-3 PRs:
1. **Backend gating + tests** (guard en las 4 rutas de escritura). Deploy con flag aún TRUE → sin cambio de comportamiento.
2. **UI gating** (banner + ocultar "Nueva" + prompt) + **sync del landing**.
3. **Aviso** (banner de transición + email) y, en día del flip, **migración 266**.
