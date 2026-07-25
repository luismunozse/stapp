# Diseño: recepción múltiple en mostrador

**Fecha:** 2026-07-25
**Estado:** aprobado
**Alcance:** permitir que un cliente deje varios equipos en una sola atención de mostrador, generando una orden por equipo agrupadas bajo un comprobante de recepción único con una sola firma. Feature opcional, gateada por plan, estrictamente aditiva sobre el flujo actual.

## Contexto y problema

El modelo actual es **una orden = un equipo**, con los datos del equipo planos en la orden: `dispositivo` y `tipo_dispositivo` (`supabase/migrations/001_schema.sql:189-190`), `marca` / `color` / `imei` / `accesorios` / `password_dispositivo` (`supabase/migrations/007_ordenes_extra_columns.sql:6-10`) y `metadata` JSONB para los campos extra por tipo (`supabase/migrations/049_device_type_config.sql:5`). No existe tabla `equipos` ni `dispositivos`.

Cargar **varias órdenes para el mismo cliente** ya funciona (`clientes` 1..N `ordenes_servicio` vía `cliente_id`), y las piezas que suelen doler están resueltas: cobro consolidado de varias órdenes (`components/ordenes/cobrar-multiple-dialog.tsx`), cliente 360 con pendientes e historial (`components/clientes/detalle/`), cuenta corriente por cliente (`supabase/migrations/066_cuenta_corriente_pagos_combinados.sql:26`) y deduplicación del cliente por teléfono (`UNIQUE(organization_id, telefono)`).

Lo que **no** existe es la atención de mostrador donde el cliente deja 3 equipos juntos y se va con **un** papel firmado **una** vez. Hoy eso son 3 altas completas, 3 comprobantes y 3 firmas.

Dos hallazgos del relevamiento condicionan el diseño:

1. **La firma de recepción no vive donde parece.** La columna `ordenes_servicio.firma_cliente_recepcion` (`supabase/migrations/027_firma_recepcion_fields.sql:4`) está **muerta**: ningún archivo del repo la lee ni la escribe. La firma real vive en `checklist_recepcion.firma_cliente` (`supabase/migrations/061_checklist_recepcion_firma_fields.sql:3`), y esa tabla es **1:1 con la orden** (`orden_id TEXT UNIQUE`, `supabase/migrations/001_schema.sql:442`), con template elegido por tipo de dispositivo. Es decir: hoy la firma está estructuralmente atada a un checklist por orden, y 3 equipos heterogéneos pueden requerir 3 templates distintos.

2. **El guardado de la firma se traga los errores.** El checklist (y con él la firma) se persiste en un **segundo request no transaccional** después de crear la orden, y sus fallas terminan en `console.error` sin llegar al operador (`components/ordenes/orden-form.tsx:710-714`). Hoy un taller puede quedarse con una orden sin firma y no enterarse. Es un bug latente del flujo clásico; en un flujo de N equipos se volvería grave.

Restricción de producto explícita del pedido: **no romper el flujo de los talleres que reciben un equipo por vez**, que son la mayoría.

## Decisiones de producto

Tomadas durante el brainstorming y cerradas:

| Decisión | Elegido |
|---|---|
| Qué recibe el cliente | Un comprobante con los N equipos y **una** firma |
| Seña al ingreso | **Sin seña** en el flujo múltiple; se cobra después por orden o con el cobro múltiple existente |
| Campos por equipo | Mínimo (tipo, marca/modelo, IMEI/serie, falla, accesorios) **+ fotos de ingreso** |
| Seguimiento | **Un** WhatsApp con los N links, reusando `public_token` y `/seguimiento` |
| Activación | Gateada a plan **Profesional y Pro** vía `hasPlanFeature` |

## Objetivos

- Una atención de mostrador que cargue N equipos del mismo cliente en una pasada, con una firma y un comprobante.
- **Cero cambio de comportamiento** para el flujo de alta actual, verificado por test, no afirmado.
- Creación atómica: o se crean la recepción y las N órdenes, o no se crea nada.
- La firma se persiste dentro de la transacción, sin el agujero del flujo clásico.
- Cada orden sigue siendo la unidad atómica del ciclo de vida (estado, costo, cobro, entrega, garantía, etiqueta).

## No-objetivos

- **No** se introduce el concepto de "varios equipos en una orden". Eso obligaría a reescribir la máquina de estados, el cobro, la entrega con firma, las etiquetas, los reportes y la facturación.
- **No** se toca `POST /api/ordenes` ni `PUT /api/ordenes/[id]`.
- **No** se toca la máquina de estados ni `lib/orden-transicion.ts`.
- **No** hay página pública del lote (el cliente recibe los N links de seguimiento por orden que ya existen).
- **No** hay checklist por equipo en el mostrador. Se completa después desde cada orden.
- **No** hay seña, entrega agrupada ni cobro agrupado desde el lote.
- **No** se arregla en este alcance el bug del checklist del flujo clásico (ver "Deuda detectada").

## Diseño

### 1. Modelo de datos

Migración nueva. **Verificar el número libre al implementar**: en esta branch el último aplicado es `276_foto_borrador.sql`, pero hay un `276` reservado por la branch de facturación electrónica sin mergear. Nombre tentativo: `277_recepcion_multiple.sql`.

```sql
CREATE TABLE recepciones (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sucursal_id TEXT REFERENCES sucursales(id),
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  codigo TEXT NOT NULL,                 -- REC001
  firma_cliente TEXT,                   -- base64, una sola vez
  firma_mime TEXT,
  terminos_aceptados BOOLEAN NOT NULL DEFAULT FALSE,
  recibido_por TEXT REFERENCES users(id),
  observaciones TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(organization_id, numero)
);

CREATE INDEX recepciones_org_created_idx ON recepciones(organization_id, created_at DESC);
CREATE INDEX recepciones_cliente_idx ON recepciones(organization_id, cliente_id);

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS recepcion_id TEXT REFERENCES recepciones(id) ON DELETE SET NULL;

CREATE INDEX ordenes_recepcion_idx ON ordenes_servicio(recepcion_id)
  WHERE recepcion_id IS NOT NULL;
```

RLS con el mismo patrón que el resto de las tablas de la app:

```sql
ALTER TABLE recepciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_recepciones" ON recepciones
  FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text))
  WITH CHECK (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()::text));
```

Cuatro decisiones estructurales, con su razón:

- **`recepciones` no tiene columna `estado`.** Es un documento, no una entidad con ciclo de vida. Esa ausencia es la garantía estructural de que la feature no toca la máquina de estados ni el helper `transicionarOrden`. El ciclo de vida sigue siendo 100% por orden.
- **`recepcion_id` es nullable.** Toda orden creada por el flujo clásico queda en `NULL`. El lote es una decoración opcional de la orden, nunca un requisito; ninguna query de negocio puede asumir que existe.
- **Índice parcial** (`WHERE recepcion_id IS NOT NULL`): cero costo de escritura y de espacio para el flujo clásico, que es el 99% de las filas.
- **`ON DELETE SET NULL`, no CASCADE.** Borrar una recepción no puede arrastrarse las órdenes con los equipos del cliente adentro.

`recibido_por` replica el tipo y la semántica de `ordenes_servicio.recibido_por` (`supabase/migrations/260_ordenes_recibido_por.sql:8`) y se resuelve server-side con `resolveOperador` (`lib/operadores.ts:8`), igual que en el alta actual.

### 2. RPC atómica `crear_recepcion_multiple`

Precedente a seguir: `crear_venta_atomica` (`supabase/migrations/079_fix_crear_venta_atomica.sql`). El cliente JS de Supabase no da transacciones multi-statement, y el patrón de compensación manual que usa el POST actual (`app/api/ordenes/route.ts:437` y `:446`) no escala a N inserts.

```
crear_recepcion_multiple(
  p_organization_id  TEXT,
  p_sucursal_id      TEXT,
  p_cliente_id       TEXT,
  p_equipos          JSONB,   -- array de equipos
  p_firma_cliente    TEXT,
  p_firma_mime       TEXT,
  p_terminos         BOOLEAN,
  p_recibido_por     TEXT,
  p_created_by       TEXT
) RETURNS JSONB               -- { recepcion: {...}, ordenes: [...] }
```

Dentro de una única transacción:

1. Inserta la fila de `recepciones`. El número sale de un **contador propio, independiente del de órdenes**: `MAX(numero) + 1` dentro de la misma transacción, protegido por el `UNIQUE(organization_id, numero)`. El código se formatea `REC` + padding de 3 dígitos, mismo criterio que `lib/counters.ts:44-46`. No se reusa `get_next_order_number` para no consumir numeración de órdenes con documentos de recepción.
2. Recorre `p_equipos`. Para cada uno: resuelve el prefijo desde `tipos_dispositivo.prefijo_orden`, saca el siguiente número con el contador atómico ya existente, y hace el INSERT en `ordenes_servicio` con `recepcion_id`, `public_token` propio y `estado = 'RECIBIDO'`.
3. Devuelve la recepción y las órdenes creadas.

Dos propiedades que caen de regalo y conviene dejar escritas:

- El trigger `update_ordenes_count` ya rollbackea la transacción entera cuando se excede el límite de órdenes del plan (comportamiento documentado en `app/api/ordenes/route.ts:417-418`). Al estar todo en una transacción, la atomicidad del límite sale gratis: desaparece el escenario "2 equipos cargados y el tercero no". `isPlanLimitError` / `planLimitErrorResponse` (`lib/plan-limits.ts:20` y `:29`) siguen reportándolo bien.
- La firma entra **dentro** de la transacción, no en un segundo request. El bug de `orden-form.tsx:710-714` no puede reproducirse acá por construcción: o hay recepción firmada, o no hay nada.

**Fotos fuera de la RPC.** Son uploads a Supabase Storage, no caben en una transacción de Postgres. Se suben después de que la RPC commitea, por orden, best-effort, con el mismo criterio que hoy (`app/api/ordenes/route.ts:489`: una foto que falla no aborta el resto). Que falle una foto no puede invalidar una recepción ya firmada.

`estado` inicial es siempre `RECIBIDO`. El flujo múltiple no captura presupuesto, así que no existe la rama `presupuestoAceptado → EN_REPARACION` del alta clásica (`app/api/ordenes/route.ts:357`).

### 3. Gate de plan

Feature key: **`recepcion_multiple`**. La misma migración prende el flag en los planes Profesional y Pro.

El primitivo ya existe y respeta trial vencido, período vencido, `CANCELED` y `PAST_DUE`: `hasPlanFeature(organizationId, featureKey)` (`lib/subscriptions.ts:360`), con override por organización vía `organization_feature_overrides` (`lib/subscriptions.ts:339`). Ese override es la escotilla para habilitárselo puntualmente a un taller Free desde el superadmin, sin cambiarle el plan y sin construir un toggle nuevo.

- **Server:** `POST /api/recepciones` chequea `hasPlanFeature` y devuelve 403 `{ error, code: "FEATURE_REQUIRED", feature: "recepcion_multiple" }`, mismo shape que los gates de whatsapp, reportes y cotizaciones.
- **Cliente:** `useHasFeature("recepcion_multiple")` (`hooks/use-subscription.ts`) esconde el punto de entrada.

Lección ya documentada en el repo que aplica de lleno (ver `docs/superpowers/specs/2026-07-05-rediseno-free-cotizaciones-gating-design.md:22`): en el rediseño de cotizaciones las rutas **nunca chequeaban** el flag, así que apagarlo en la DB no cambiaba el comportamiento. **El enforcement va en código desde el día uno**, no solo el flag en la migración.

### 4. API

`POST /api/recepciones` — ruta nueva, archivo nuevo. Body:

```ts
{
  clienteId: string,
  equipos: Array<{               // mínimo 2
    dispositivo: string,
    tipoDispositivo: string,
    marca?: string,
    color?: string,
    imei?: string,
    problemaReportado: string,
    accesorios?: string,
    codigoAccesoDispositivo?: string,
    metadata?: Record<string, unknown>,
    fotos?: Array<{ data: string, mime: string, descripcion?: string }>,
  }>,
  firmaCliente?: string,
  firmaMime?: string,
  terminosAceptados: boolean,
  recibidoPorId?: string | null,
  observaciones?: string,
  telefonoContacto?: string,
}
```

Los campos de nivel raíz son **del lote** y se aplican a las N órdenes: `telefonoContacto` se copia en `ordenes_servicio.telefono_contacto` de cada orden (la columna es por orden, `supabase/migrations/104_orden_telefono_contacto.sql:5`), mientras que `observaciones` queda solo en `recepciones` y no se replica. Los campos por equipo viven exclusivamente dentro de cada elemento de `equipos`.

Lo que el flujo múltiple **no** acepta, y por eso no está en el body: `presupuesto`, `sena`, `metodoPagoSena`, `fechaPrometida`, `tecnicoId`, `sectorId` y `fromTurnoId`. Se completan después desde cada orden con el `PUT` existente.

Orden de operaciones:

1. `requireAuth()`
2. Gate `hasPlanFeature(org, "recepcion_multiple")` → 403 si no
3. Validación Zod, incluido `equipos.length >= 2`
4. Validación de IMEI por tipo, reusando `tipoValidaImei` + `isValidImei` para cada equipo (mismo criterio que `app/api/ordenes/route.ts:283-291`)
5. `sucursalParaEscritura(...)` y `resolveOperador(...)`
6. RPC `crear_recepcion_multiple`
7. Fotos por orden, best-effort
8. Auditoría: un `audit.create("recepciones", ...)` más un `audit.create("ordenes_servicio", ...)` por orden
9. `orden_eventos` de creación por orden, fire-and-forget, igual que hoy (`app/api/ordenes/route.ts:507-520`)

`POST /api/ordenes` **no se toca**. Ni una línea.

### 5. Extracción de componentes

`components/ordenes/orden-form.tsx` tiene **1743 líneas**. Agregarle un modo "múltiple" con condicionales significa que cualquier bug introducido ahí lo comen **todos** los talleres, incluidos los que reciben un equipo por vez. Ese es el riesgo real de contaminación de esta feature, y no está en la base de datos.

Se extraen dos componentes, consumidos por el form actual y por el flujo nuevo:

- `components/ordenes/dispositivo-fields.tsx` — selector de tipo, campos dinámicos del `config` del tipo (imei/color/marca/password), `camposExtra`, accesorios y problemas comunes.
- `components/ordenes/fotos-ingreso.tsx` — captura y preview de fotos de ingreso.

**Disciplina obligatoria:** la extracción es un **movimiento puro, sin un solo cambio de comportamiento**, y va en su **propio commit**, con los tests existentes en verde, **antes** de que exista una línea del flujo nuevo. Mezclar extracción y feature nueva en un commit destruye la capacidad de saber cuál de las dos rompió el mostrador de todos los talleres.

### 6. UI del flujo

**Ruta propia, no dialog:** `app/(dashboard)/ordenes/recepcion/page.tsx`.

El alta actual es un dialog dentro de `components/ordenes/ordenes-list.tsx:856`, controlado por el estado `showForm`. Para el flujo múltiple se elige una ruta por tres razones, y la tercera es la decisiva: N equipos con fotos y firma no entran cómodos en un modal sobre una tablet de mostrador; la ruta es deep-linkeable; y `ordenes-list.tsx` ya pasa las 1000 líneas — con una ruta aparte ese archivo recibe **+6 líneas** (un botón detrás del flag) en lugar de una rama de dialog completa.

Punto de entrada: botón secundario junto al `Plus` existente (`components/ordenes/ordenes-list.tsx:605` en desktop y `:1013` en mobile), envuelto en `useHasFeature("recepcion_multiple")`.

La página, en tres pasos:

1. **Cliente** — reusa el selector de cliente del form actual.
2. **Equipos** — lista de cards con `<DispositivoFields>` y `<FotosIngreso>`, más un botón "Agregar equipo". Mínimo 2: con un solo equipo el flujo clásico ya sirve y es más rápido.
3. **Firma única, términos y confirmar** — `SignaturePad` (`components/firma/signature-pad.tsx`), una sola vez para todo el lote.

### 7. Comprobante y etiquetas

- `components/ordenes/thermal-print-recepcion.tsx`, reusando la infraestructura de `thermal-print-orden.tsx`: los N equipos con su código de orden, **una** firma y un bloque de términos. Encabezado con el código de la recepción (`REC001`) para que el cliente pueda referenciarlo por teléfono.
- Etiquetas: loop sobre `printDeviceLabel` (`components/ordenes/print-label.ts`), una por equipo. Cero infraestructura de impresión nueva; sigue imprimiendo por driver del sistema operativo.
- `components/ordenes/recepcion-creada-modal.tsx`, análogo a `orden-creada-modal.tsx`: imprimir comprobante, imprimir las N etiquetas, enviar el WhatsApp.

### 8. Notificación

El endpoint nuevo **no** llama a `queueNotification`. El mensaje único con los N links de seguimiento sale del modal de éxito, manual, client-side con `generateWhatsAppUrl` (`lib/notifications/whatsapp-templates.ts`), igual que el alta actual ofrece hoy.

**Consecuencia asumida a propósito, no accidental:** un taller con `notificaciones_whatsapp` prendida (`lib/notifications/send-direct.ts:143`) **no** recibirá aviso automático por este flujo, aunque sí lo siga recibiendo por el flujo clásico (`app/api/ordenes/route.ts:554`). El automático por orden serían N mensajes seguidos al mismo teléfono, que es exactamente lo que se decidió evitar; el automático agrupado requiere un tipo de notificación y un template nuevos que no justifican la v1. El operador tiene al cliente enfrente y es un click.

Si más adelante se quiere automático agrupado, es un slice aditivo que no toca nada de este diseño.

### 9. Testing (TDD estricto)

Los tests van primero, con una excepción: la extracción del punto 5 se valida con los tests que **ya** existen, porque su contrato es "nada cambia".

| Test | Qué prueba |
|---|---|
| `__tests__/api/ordenes-recepcion-null.test.ts` | **El que da derecho a mergear:** el POST clásico deja `recepcion_id` en `NULL` y la respuesta no cambia de shape |
| `__tests__/api/recepcion-multiple-atomica.test.ts` | Org con lugar para 2 órdenes y se mandan 3 → **cero** filas en `recepciones` y en `ordenes_servicio` |
| `__tests__/api/recepcion-multiple-gate.test.ts` | Free → 403 `FEATURE_REQUIRED`; con override habilitado en `organization_feature_overrides` → 200 |
| `__tests__/api/recepcion-firma-unica.test.ts` | La firma se persiste **una** vez en `recepciones`, y el PDF de cada orden la resuelve por el fallback |
| `__tests__/lib/recepcion-whatsapp.test.ts` | El mensaje agrupado lista los N códigos con su link de seguimiento correcto |
| `e2e/recepcion-multiple.auth.spec.ts` | Flujo completo de mostrador con `storageState`, siguiendo la convención de la suite autenticada |

Convención a seguir para los tests de API: helpers de `__tests__/api/helpers` (`mockAuthSuccess`, `createChainMock`, `mockSupabaseFrom`, `createPostRequest`, `parseResponse`), como en `__tests__/api/cobros-orden-atomico.test.ts`.

### 10. Entrega

Tres work units, en este orden, cada uno con sus tests en verde antes de pasar al siguiente:

1. **Extracción** de `dispositivo-fields.tsx` y `fotos-ingreso.tsx`, sin cambio de comportamiento, con los tests existentes en verde. Incluye el test de regresión `ordenes-recepcion-null`.
2. **Backend**: migración (tabla, FK, índices, RLS, feature flag), RPC `crear_recepcion_multiple`, `POST /api/recepciones` con el gate. Tests de atomicidad, gate y firma única.
3. **Frontend**: ruta `/ordenes/recepcion`, botón de entrada detrás del flag, comprobante térmico, etiquetas en loop, modal de éxito con el WhatsApp agrupado. Test e2e.

El fallback de firma en el PDF (`app/api/ordenes/[id]/pdf/route.ts:163` pasa de `checklistData?.firma_cliente` a `checklistData?.firma_cliente ?? recepcion?.firma_cliente`) va en el work unit 2. Con `recepcion_id` en `NULL` el segundo operando nunca se evalúa, así que el comportamiento del flujo clásico es idéntico.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La extracción rompe el alta de todos los talleres | Commit separado, movimiento puro, tests existentes en verde antes de seguir. Es el riesgo más alto de la feature |
| Colisión de número de migración con la branch de facturación electrónica | Verificar el número libre al implementar; en esta branch el último es `276_foto_borrador.sql` |
| El flag queda prendido en la DB pero sin enforcement en código | Test de gate explícito (`recepcion-multiple-gate`), siguiendo la lección del rediseño de cotizaciones |
| Un taller espera WhatsApp automático y no llega | Decisión documentada en el punto 8; el modal lo ofrece a un click. Follow-up aditivo si se pide |
| Fotos que fallan tras commitear la RPC | Best-effort explícito, igual que hoy; la recepción firmada queda válida y las fotos se pueden agregar después desde cada orden |
| Se filtra la idea de "N equipos por orden" durante la implementación | `recepciones` sin columna `estado` es la barrera estructural: no hay dónde poner un ciclo de vida de lote |

## Deuda detectada, fuera de alcance

Encontrada durante el relevamiento, **no** se arregla en este diseño:

1. **El checklist del flujo clásico se traga los errores** (`components/ordenes/orden-form.tsx:710-714`): si el POST del checklist falla, la orden queda sin firma y el operador no se entera. El flujo nuevo no puede tener ese bug por construcción, pero el clásico sí lo tiene. Merece su propio slice, su propio test y su propio commit, precisamente porque tocar ese archivo es tocar el mostrador de todos los talleres.
2. **`ordenes_servicio.firma_cliente_recepcion` y `firma_cliente_recepcion_mime` son columnas muertas** (`supabase/migrations/027_firma_recepcion_fields.sql:4-5`): sin lector ni escritor en todo el repo. Candidatas a limpieza en una migración de deuda, no acá.
