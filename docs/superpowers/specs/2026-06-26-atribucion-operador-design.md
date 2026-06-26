# Atribución de operador — quién recibió / quién vendió (v1)

**Fecha:** 2026-06-26 · **Estado:** Diseño aprobado

## Problema

En un negocio con varios vendedores/técnicos por turno y **una sola PC**, cada acción queda atribuida al usuario logueado (sesión compartida del mostrador), no a la persona real que la hizo. Dos casos concretos:

1. **Órdenes:** no se registra **quién recibió el equipo**. Hoy `ordenes_servicio` solo guarda `tecnico_id` (quién repara); el creador queda únicamente en el audit log atado a la sesión (`app/api/ordenes/route.ts:491`). No hay campo "recibido por".
2. **Ventas:** `vendedor_id` se fuerza al usuario logueado (`app/api/ventas/route.ts:302`, `p_vendedor_id: userId!`). No se puede atribuir la venta al vendedor real → comisiones (`v_comisiones_ventas`, mig 122/256) van al usuario de la sesión, no al que vendió.

El patrón ya existe a medias: el formulario de orden tiene un selector de **técnico asignado** (`components/ordenes/orden-form.tsx:1128-1146`) que escribe `ordenes_servicio.tecnico_id` (cualquier usuario, no el de sesión).

## Objetivo

Permitir **elegir el operador** (quién recibió / quién vendió) en el momento de la acción, con **selección libre (sin PIN)**, sin tocar login ni autenticación. Mantener trazabilidad real combinando: *quién fue atribuido* (en el registro) + *quién operó* (audit log de la sesión).

## Decisiones (cerradas)

1. **Selección libre, sin PIN.** Un selector de operador, sin validación de identidad. No toca `users` ni el login. (PIN = etapa futura si aparece mis-atribución.)
2. **Alcance v1:** (a) `recibido_por` en órdenes; (b) `vendedor_id` seleccionable en POS. (Técnico ya existe; no se toca.)
3. **Trazabilidad doble SIN tocar el audit:** el actor atribuido queda en el registro (`recibido_por` / `vendedor_id`); el operador autenticado queda en el audit log existente (`user_id` = sesión). No se modifica `lib/audit.ts`.
4. **Ventas: sin columna nueva.** Se reutiliza `ventas.vendedor_id`; solo se vuelve seleccionable. Comisiones siguen al vendedor elegido (deseado).
5. **Default = usuario logueado**, editable. `recibido_por` opcional (nullable).
6. **Sesión compartida = ADMIN** (recomendado). El filtro de visibilidad "VENDEDOR ve solo sus ventas" (`ventas/route.ts:101-103`) y el de técnico (`ordenes/route.ts:120`) siguen atados al **rol de la sesión**, no al actor elegido.
7. **Lista de operadores = usuarios activos de la sucursal activa.** Para vendedor: roles VENDEDOR/ADMIN; para recibido_por: cualquier activo.
8. **Server-authoritative:** la ruta valida que el actor elegido pertenezca a la org (y, para vendedor, que sea rol válido) antes de persistir; un id inválido → rechazo o fallback al usuario de sesión.

## Arquitectura

### A. Migración — `ordenes_servicio.recibido_por`

Próximo número libre (al escribir: `260`; verificar `ls supabase/migrations | grep -oE '^[0-9]+' | sort -n | tail -1`).

```sql
ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS recibido_por TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS ordenes_recibido_por_idx
  ON ordenes_servicio(organization_id, recibido_por);
```

Nullable, sin backfill (órdenes viejas quedan en null). Se aplica a Supabase manualmente post-merge (como 230/238/259).

### B. Endpoint de operadores

Reutilizar o crear un endpoint que liste usuarios activos de la sucursal activa.
- Verificar si ya existe (`/api/tecnicos`, `/api/vendedores`, o `/api/usuarios`) y reutilizar.
- **`/api/tecnicos`** ya existe y lista técnicos por sucursal (usado por el selector de técnico). **`/api/vendedores`** existe (visto en el árbol de rutas). El plan debe confirmar sus contratos y, si hace falta, un listado de "operadores activos de la sucursal" para `recibido_por` (cualquier rol). Reusar antes que crear.

### C. Órdenes — selector "Recibido por"

- `components/ordenes/orden-form.tsx`: agregar selector "Recibido por" espejo del de técnico (`:1128-1146`). Estado `selectedRecibidoPorId`, default `session.user.id`. Lista = operadores activos de la sucursal.
- Payload: agregar `recibidoPorId`.
- `app/api/ordenes/route.ts` (POST, ~`:378-403`): validar que `recibidoPorId` pertenezca a la org; setear `recibido_por` en el INSERT. Si ausente/ inválido → `userId` de la sesión (fallback) o null (decidir en plan; default recomendado = `userId` de la sesión para no perder el dato).
- Mostrar "Recibido por" en el detalle de la orden y en el ticket/comprobante de ingreso.

### D. POS — selector "Vendedor"

- `components/pos/pos-checkout-dialog.tsx` (o donde se arma el checkout): selector "Vendedor", default `session.user.id`, lista = vendedores/admins activos de la sucursal.
- Payload (`pos-payload.ts` / `VentaPayload`): agregar `vendedorId`.
- `app/api/ventas/route.ts`: validar `vendedorId` (org + rol válido); usar en `p_vendedor_id` en vez de forzar `userId`. Si ausente/ inválido → `userId` de la sesión (fallback).
- `ventaSchema` (`route.ts:23-50`): agregar `vendedorId: z.string().nullable().optional()`.

## Casos borde

- **Actor inválido / de otra org** → server lo descarta y cae al `userId` de la sesión (nunca persiste un id ajeno).
- **Sesión rol VENDEDOR elige a otro vendedor** → la venta se atribuye al elegido, pero el filtro "ve solo las suyas" (atado al rol de sesión) haría que no la vea después. Documentado; se recomienda sesión ADMIN/terminal. No se bloquea.
- **`recibido_por` no elegido** → default `userId` de la sesión (no se pierde el dato).
- **Comisión:** sigue a `ventas.vendedor_id` (el elegido). Es el comportamiento buscado.

## No-goals (fuera de alcance)

- PIN / gate de identidad (etapa futura).
- Selección de técnico (ya existe).
- Rol "Caja"/"Terminal" nuevo (se usa ADMIN).
- "On behalf of" en el audit log (la doble traza ya queda entre registro + audit).
- Backfill de `recibido_por` en órdenes históricas.
- Atribución de operador en otras acciones (cobros, entregas, etc.).

## Archivos afectados (resumen)

- **Nuevo:** migración `ordenes_servicio.recibido_por`; posiblemente un endpoint de "operadores de sucursal" (si no se puede reutilizar uno existente).
- **Editar (órdenes):** `components/ordenes/orden-form.tsx`, `app/api/ordenes/route.ts`, vista de detalle/ticket de orden.
- **Editar (POS):** `components/pos/pos-checkout-dialog.tsx`, `components/pos/pos-payload.ts`, `app/api/ventas/route.ts`.
- **Tests:** unit del enforcement server-side (actor inválido → fallback a sesión; actor válido → persistido) en `/api/ordenes` y `/api/ventas`.
