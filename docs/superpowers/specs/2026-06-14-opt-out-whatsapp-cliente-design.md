# Opt-out de WhatsApp por cliente

**Fecha:** 2026-06-14 · **Estado:** Diseño aprobado

## Problema

No hay forma de excluir a un cliente de las notificaciones automáticas por WhatsApp. Algunos clientes no quieren recibirlas (consentimiento / buenas prácticas).

## Objetivo

Que el taller pueda marcar por cliente si recibe WhatsApp. Por defecto reciben; se desmarca a quien no quiere. Solo afecta **WhatsApp** (el email no se toca). El chequeo vive en el único punto de envío para que ningún flujo lo saltee.

## Decisiones (cerradas)

1. **Campo `clientes.acepta_whatsapp BOOLEAN NOT NULL DEFAULT true`** (framing positivo opt-in). Default true → todos los clientes existentes y nuevos reciben salvo que se desmarque.
2. **Gate en `send-direct.ts`** (no en el context): cargar `acepta_whatsapp` por `clienteId` y gatear el bloque WhatsApp. Un solo lugar, robusto contra olvidos de los call sites.
3. **Solo WhatsApp**: el email sigue saliendo según `notificaciones_email`.
4. **UI**: checkbox en el form de cliente, marcado por defecto.

## Arquitectura

### Migración (DB — aplicar en prod por el usuario)
`supabase/migrations/217_clientes_acepta_whatsapp.sql`:
```sql
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS acepta_whatsapp BOOLEAN NOT NULL DEFAULT true;
```

### Gate en envío (`lib/notifications/send-direct.ts`)
- El bloque WhatsApp está en `:139` (`if (orgConfig.notificaciones_whatsapp && context.cliente.telefono)`).
- Antes de ese bloque, cargar el flag del cliente:
  ```ts
  let aceptaWhatsapp = true
  if (clienteId) {
    const { data: cli } = await supabaseAdmin
      .from("clientes")
      .select("acepta_whatsapp")
      .eq("id", clienteId)
      .single()
    aceptaWhatsapp = cli?.acepta_whatsapp ?? true
  }
  ```
- Gatear: `if (orgConfig.notificaciones_whatsapp && context.cliente.telefono && aceptaWhatsapp) { ... }`.
- `clienteId` ya es parámetro de `sendNotificationDirect`/`NotificationParams`. Si por defecto (cliente sin registro) → `true` (recibe).

### Form de cliente (`components/clientes/cliente-form.tsx`)
- Schema: `aceptaWhatsapp: z.boolean().default(true)`.
- Default values: `aceptaWhatsapp: cliente?.aceptaWhatsapp ?? true` (edición) / `true` (alta).
- UI: checkbox/switch "Acepta notificaciones por WhatsApp" (marcado por defecto). Ubicar cerca del teléfono.

### Route de clientes (`app/api/clientes` POST/PUT)
- Aceptar `aceptaWhatsapp` en el schema Zod del body.
- Persistir `acepta_whatsapp: data.aceptaWhatsapp ?? true` en insert/update.
- Devolver el campo en el GET/response (mapear `acepta_whatsapp` → `aceptaWhatsapp`).

### Type (`types/index.ts`)
- Agregar `aceptaWhatsapp?: boolean` (o el casing que use el Cliente type) al type Cliente, y mapearlo en `formatCliente`/`db-utils` si existe.

## Edge cases
- Cliente sin el campo (datos viejos pre-migración) → la columna tiene DEFAULT true por la migración, así que ya viene true. Si el query falla → fallback `true` (recibe).
- Email: nunca afectado por `acepta_whatsapp`.
- Desmarcar opt-out a un cliente con teléfono → no recibe WhatsApp; el log de WhatsApp simplemente no se genera.

## Testing
- **Route de clientes** (`__tests__/api/clientes.test.ts`): POST con `aceptaWhatsapp: false` → persiste `acepta_whatsapp: false`; sin el campo → default true.
- **send-direct gate**: no es unit-testeable en aislamiento (el módulo arrastra imports server-only). Se cubre por smoke manual: cliente con `acepta_whatsapp=false` no recibe WhatsApp en un cambio de estado; con true sí. (Si se quiere test, extraer un helper puro `puedeRecibirWhatsapp(orgConfig, telefono, aceptaWhatsapp)` — opcional.)
- Form: sin unit test (UI); verificar por build + smoke.

## Fuera de alcance
- Opt-out de email / por canal granular.
- Doble opt-in / registro de consentimiento con timestamp (solo el flag booleano por ahora).
- Link de baja ("STOP") en el mensaje.
