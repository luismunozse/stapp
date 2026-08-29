# Diseño: reparaciones express cobrables desde el detalle del cliente

**Fecha:** 2026-08-24
**Estado:** propuesto
**Alcance:** permitir cargar, desde el detalle de un cliente, un listado de reparaciones ya hechas y cobrarlas a su cuenta corriente en una sola pasada, sin pasar por el ciclo de vida de una orden de servicio. Incluye dos trabajos previos obligatorios que el relevamiento destapó: el arreglo del doble conteo de deuda de fiado y la reversa de cargos de fiado, hoy inexistente. Feature opcional, gateada por plan, estrictamente aditiva.

## Contexto y problema

El pedido original fue: *"ingresar un listado de reparaciones dentro del detalle de cliente para ser cobradas y que queden en su cuenta corriente, sin necesidad de que sea una orden de reparación o varias órdenes de reparación"*.

El caso real es el taller que atiende a un cliente recurrente (otro comercio, un revendedor, un cliente de mostrador de confianza): le arregla cinco equipos a lo largo de la semana y quiere cargarle las cinco reparaciones de una, que queden como deuda, y cobrarle después. Abrir cinco órdenes con recepción, firma, diagnóstico, presupuesto, reparación y entrega es un costo de operación que no paga nada.

### Por qué el diseño igual usa órdenes

El pedido decía "sin órdenes", pero los requisitos que se cerraron durante el brainstorming fueron:

1. datos estructurados por reparación (equipo, tipo, marca, IMEI, trabajo realizado),
2. búsqueda global por IMEI / número de serie,
3. historial: "¿qué le hicimos a este equipo?".

Los tres ya existen, y existen **solo** sobre `ordenes_servicio`:

- columnas de equipo: `marca`, `color`, `imei`, `accesorios` (`supabase/migrations/007_ordenes_extra_columns.sql:6-10`), más `dispositivo` y `tipo_dispositivo` (`supabase/migrations/001_schema.sql:189-190`)
- índice de IMEI (`supabase/migrations/007_ordenes_extra_columns.sql:13`)
- `search_vector` con IMEI en peso A y la RPC `search_all` que alimenta el buscador global (`supabase/migrations/162_ordenes_search_imei.sql:8-30, 71-93`)
- expediente de orden, fotos, etiqueta térmica, garantía

La alternativa evaluada era una **venta con líneas manuales**: `items_venta.inventario_id` es nullable y `app/api/ventas/route.ts:13` acepta ítems sin inventario, y `metodoPago` ya incluye `CUENTA_CORRIENTE` (`app/api/ventas/route.ts:33`). Era viable. Se descartó porque para cumplir (1), (2) y (3) obligaba a: migración con columnas + índices en `items_venta`, un `search_vector` nuevo, extender la RPC `search_all` con un tipo de resultado nuevo, tocar los tres comprobantes (ticket térmico, A4 react-pdf y `lib/facturacion/items-factura.ts`) y dejar el historial del equipo como un `UNION` permanente entre `ordenes_servicio` e `items_venta`. Dos fuentes de verdad para el mismo concepto, para siempre.

La decisión fue: el dolor del usuario es el **flujo** de la orden, no la entidad. Este diseño elimina el flujo y conserva la entidad.

## Hallazgos del relevamiento

Cinco hallazgos condicionan el diseño. Los dos últimos son bugs vivos que este trabajo tiene que cerrar antes de agregar nada.

1. **`CUENTA_CORRIENTE` significa dos cosas opuestas según el endpoint.** En `app/api/ordenes/[id]/cobros/route.ts:281` el método `CUENTA_CORRIENTE` llama a `usar_cuenta_corriente` (tipo `USO`): **consume saldo a favor**, no genera deuda. La deuda (tipo `CARGO`) la genera únicamente `app/api/ordenes/[id]/entregar/route.ts:187` vía `cargar_deuda_cuenta_corriente`, cuando la orden se entrega con pendiente > 0. Este diseño necesita `CARGO`, así que **no** pasa por el endpoint de cobros.

2. **`RECIBIDO → ENTREGADO` no es una transición válida.** `lib/orden-state-machine.ts:12` permite desde `RECIBIDO` solo `EN_DIAGNOSTICO`, `PRESUPUESTADO`, `EN_REPARACION`, `CANCELADO`, `SIN_REPARACION`, `SIN_FALLA_DETECTADA` y `ENTREGADO_SIN_COBRO`. El camino a `ENTREGADO` pasa obligatoriamente por `REPARADO`. Por lo tanto la orden express **nace** en estado terminal (una creación, no una transición), igual que la recepción múltiple hace nacer las suyas en `RECIBIDO` (`supabase/migrations/288_crear_recepcion_multiple.sql:121`). La máquina de estados global no se toca ni se debilita.

3. **No existe columna `modelo`.** `ordenes_servicio` tiene `dispositivo` como texto libre, que es donde toda la app ya escribe el modelo ("iPhone 11 Pro"). El formulario no lleva campo `modelo` separado.

4. **El `CARGO` de fiado de una orden no se puede revertir.** La primitiva de reversa **sí existe**: `devolver_cuenta_corriente` (tipo `DEVOLUCION`, monto positivo, sin validar saldo), definida en la Fase 2 de reversibilidad (`docs/superpowers/specs/2026-06-17-cc-reversibilidad-fase2-design.md`) y con firma vigente en `supabase/migrations/268_cuenta_corriente_sucursal_writers.sql:187-196`. Está cableada en cuatro puntos: devolución de venta (`app/api/ventas/[id]/devolucion/route.ts:427`), anulación y eliminación de factura (`app/api/facturacion/[id]/route.ts:334,519`) y anulación de cobro pagado con CC (`app/api/ordenes/[id]/cobros/route.ts:526`). El único punto de reversa que quedó sin cablear es justamente el `CARGO` de fiado de una orden — y encima `ENTREGADO` es estado terminal (`lib/orden-state-machine.ts:19`, lista vacía): no existe "desentregar" ni endpoint de anular orden. Es el hueco que este trabajo cierra.

5. **`get_deuda_cliente_sucursal` cuenta la deuda de fiado dos veces.** El RPC (`supabase/migrations/267_deuda_cliente_sucursal_rpc.sql:90-115`) suma dos componentes:
   - `deuda_fiado` = `GREATEST(-SUM(cuenta_corriente.monto), 0)`
   - `deuda_ordenes` = `SUM(GREATEST(costo_final - descuento_cobro - total_cobrado, 0))` sobre órdenes con `estado_cobro IN ('PENDIENTE','PARCIAL')`

   Pero `/entregar` **no toca `estado_cobro`**, y `recalcular_estado_cobro` lo deriva **solo de `cobros_orden`** (`supabase/migrations/067_cobros_orden_caja.sql:75-93`). Entonces una orden entregada a fiado queda `PENDIENTE` con `total_cobrado = 0` **y** con su `CARGO` en cuenta corriente: los dos sumandos cuentan la misma plata. Ese RPC es, según su propio comentario, *"fuente de verdad para el recordatorio de pago por WhatsApp"*: a los clientes con fiado se les está reclamando el doble. Las órdenes express caen exactamente en ese patrón, así que la feature saldría con los números mal el día uno.

Un sexto dato, relevante para la contabilidad: `app/api/reportes/ingresos-unificados/route.ts:153` suma `ventas + facturas + cobros_orden`. Una orden entregada a fiado **no cuenta como ingreso** hasta que se cobra. El `CARGO` es deuda. Este diseño hereda esa semántica sin inventar nada.

## Decisiones de producto

Cerradas durante el brainstorming:

| Decisión | Elegido |
|---|---|
| Naturaleza contable | Ingreso real por la vía existente: órdenes cobrables, ingreso al cobrar |
| Datos por reparación | Estructurados (dispositivo, tipo, marca, IMEI, trabajo, precio, garantía) |
| Trazabilidad | Búsqueda global por IMEI e historial del equipo |
| Granularidad en cuenta corriente | **Un movimiento `CARGO` por reparación**, referenciado a su orden |
| Cobro en el momento | **No.** Todo queda en cuenta corriente; el cobro se hace después por el panel existente |
| Alcance de la reversa | **Todo `CARGO` de fiado de orden**, sea express o entrega normal |
| Doble conteo de deuda | Se arregla **dentro de este trabajo**, antes de la feature |
| Permisos (carga) | ADMIN y VENDEDOR |
| Permisos (reversa) | **ADMIN únicamente** |
| Activación | Gateada por plan (Profesional y Pro) |

Justificación de las que menos se explican solas:

- **Un `CARGO` por reparación** reusa `referencia_tipo='ORDEN'` tal cual, hereda el recibo por movimiento (`app/api/clientes/[id]/cuenta-corriente/[movimientoId]/recibo/route.ts`) y permite que el cliente pague reparaciones sueltas. Un `CARGO` único por lote habría exigido un `referencia_tipo` nuevo y adaptar recibo, resumen PDF y panel.
- **ADMIN y VENDEDOR para cargar** porque hoy un vendedor ya genera fiado entregando una orden con pendiente: `entregar/route.ts` usa `requireAuth()` sin gate de rol. Poner candado acá y no allá sería incoherente.
- **Solo ADMIN para revertir** porque revertir deuda es perdonar plata. Es el mismo criterio que ya aplica el depósito a cuenta corriente (`app/api/clientes/[id]/cuenta-corriente/route.ts:87`, `role !== "ADMIN"` → 403).
- **Reversa general, no solo express**, porque acotarla al lote express dejaría dos `CARGO` idénticos en la misma cuenta corriente, uno reversible y el otro no. La asimetría sería imposible de explicar al operador.

## Objetivos

- Cargar N reparaciones de un cliente en una pasada, desde su detalle, y dejarlas como deuda en su cuenta corriente.
- Atomicidad total: o se crean las N órdenes y los N cargos, o no se crea nada.
- Que un cargo de fiado equivocado se pueda revertir sin tocar la base a mano.
- Que la deuda del cliente se reporte una sola vez.
- Cero cambio de comportamiento en el alta de órdenes, en la recepción múltiple, en `/entregar` y en el resto del panel de cuenta corriente.
- Trazabilidad heredada sin código nuevo: búsqueda por IMEI, historial del equipo, expediente, garantía, etiqueta.

## No objetivos

- No se cobra nada en el momento de cargar el lote.
- No se crea un comprobante nuevo de lote (ver *Fuera de alcance*).
- No se toca la máquina de estados ni se agregan transiciones.
- No se envían notificaciones de WhatsApp por el lote.
- No se implementa anulación genérica de cualquier movimiento de cuenta corriente (`DEPOSITO`, `PAGO`, `AJUSTE`): un `DEPOSITO` lleva `sucursal_id` y entra al arqueo de caja (mig 238), así que revertirlo toca plata física y cuadre de caja. Es otro proyecto.

---

## Slice 1 — Arreglo del doble conteo de deuda (PR1)

Va primero y solo. Es un arreglo de datos reportados, no toca UI, y su efecto es visible para los talleres: la deuda mostrada y el recordatorio de cobro **bajan** para los clientes con fiado. Baja al número correcto, pero baja, y merece su propio PR y su propio aviso.

### Cambio

Migración que redefine `get_deuda_cliente_sucursal` agregando al subquery de `deuda_ordenes`:

```sql
AND NOT EXISTS (
  SELECT 1 FROM cuenta_corriente cc2
  WHERE cc2.organization_id = o.organization_id
    AND cc2.cliente_id      = o.cliente_id
    AND cc2.tipo            = 'CARGO'
    AND cc2.referencia_tipo = 'ORDEN'
    AND cc2.referencia_id   = o.id
)
```

Regla: **si la deuda de una orden ya se movió a la cuenta corriente, la cuenta corriente es la única fuente de verdad para esa orden.**

Se mantienen los `REVOKE` / `GRANT` de la 267: la función es `SECURITY DEFINER` e ignora RLS, así que sin ellos cualquier key `anon` podría leer la deuda de cualquier cliente de cualquier organización vía PostgREST.

### Casos que el cambio respeta

| Caso | Resultado |
|---|---|
| Orden entregada a fiado completo | Cuenta solo en `deuda_fiado`. Antes contaba dos veces |
| Orden con cobro parcial y después entregada | El `CARGO` cubre exactamente el pendiente; la orden sale de `deuda_ordenes`. Sin doble conteo ni hueco |
| Orden con pendiente **sin** `CARGO` (el `cargar_deuda` de `/entregar` falló: sus errores se loguean y no abortan la entrega, `entregar/route.ts:199-202`) | Sigue contando en `deuda_ordenes`. El fix degrada bien |
| Orden entregada y después cobrada | El `PAGO` neutraliza el `CARGO` en la cuenta corriente. La orden ya estaba excluida |
| Orden nunca entregada, con costo cargado | Sin `CARGO`; cuenta en `deuda_ordenes` como siempre |

### Verificación previa al deploy

Antes de aplicar, correr en producción el conteo de órdenes afectadas y la diferencia de deuda por cliente, para poder decirle al taller cuánto va a cambiar su número. Es una consulta de solo lectura y va documentada en el PR.

---

## Slice 2 — Reversa de cargos de fiado (PR2)

### Superficie

`POST /api/clientes/[id]/cuenta-corriente/revertir`

```
{ movimientoIds: string[], motivo: string, idempotencyKey?: string }
```

Un solo endpoint para uno o N movimientos: revertir una reparación suelta y revertir un lote entero cargado por error son el mismo verbo. La UI de un movimiento manda un array de uno.

### Reglas

1. `requireAuth()` + `role === "ADMIN"`, si no 403.
2. Cada movimiento debe: pertenecer a la organización y al cliente de la ruta, tener `tipo = 'CARGO'`, `referencia_tipo = 'ORDEN'` y **no estar ya revertido**. Cualquier violación → 400 nombrando el movimiento, sin revertir nada del lote.
3. `motivo` obligatorio, mínimo 3 caracteres. Va a `observaciones` del movimiento de reversa y al log de auditoría.
4. Todo en una transacción: o se revierten los N o ninguno.

### Migración

1. Columnas de marca en `cuenta_corriente`: `revertido_at TIMESTAMPTZ`, `revertido_por TEXT REFERENCES users(id)`, `revertido_movimiento_id TEXT`. Son la defensa contra la doble reversa y lo que el panel usa para mostrar el estado. Nullable, aditivas, sin backfill.
2. RPC `revertir_cargos_orden(p_org_id, p_cliente_id, p_movimiento_ids JSONB, p_motivo, p_usuario_id)`. Por cada movimiento, dentro de una transacción:
   - lo relee `FOR UPDATE` y revalida tipo, referencia y que `revertido_at IS NULL` — la validación del endpoint es para dar buenos mensajes, la que manda es esta, bajo lock;
   - llama a `devolver_cuenta_corriente(p_org_id, p_cliente_id, ABS(monto), 'ORDEN', referencia_id, p_usuario_id, p_motivo, sucursal_id)` — la primitiva ya existente, que postea el `DEVOLUCION` positivo y actualiza `clientes.saldo_cuenta`;
   - marca el `CARGO` original con `revertido_at = NOW()`, `revertido_por`, `revertido_movimiento_id`.

   El `sucursal_id` se toma **del movimiento original**, no de la cookie del operador que revierte: la reversa tiene que caer en la misma sucursal que la deuda, o el arqueo por sucursal queda torcido. Es el mismo criterio que ya usan `entregar/route.ts:194` y `cobros/route.ts:291` al derivarlo del registro padre.

### Qué pasa con la orden

**Nada.** La orden queda en `ENTREGADO`, con su `costo_final` y su historial intactos. Es correcto: la orden existió y el trabajo se hizo; lo que se revierte es el cargo.

Y no reaparece como deuda por otro lado gracias a la regla del Slice 1: el filtro excluye las órdenes que tienen un `CARGO`, **revertido o no**. Una vez que la deuda de una orden pasó a la cuenta corriente, la cuenta corriente manda para siempre. Sin esta regla, revertir el cargo devolvería la orden a `deuda_ordenes` y la reversa no serviría de nada.

### UI

- `components/clientes/detalle/cuenta-corriente-panel.tsx`: acción **Revertir** en los movimientos `CARGO` con `referencia_tipo='ORDEN'` no revertidos, visible solo para ADMIN. Pide motivo y confirma mostrando monto y saldo resultante.
- Badge **Revertido** en los movimientos ya revertidos, con link al `DEVOLUCION` que los canceló. Sin esto, la cuenta corriente muestra un `CARGO` y un `DEVOLUCION` sueltos y el operador no ve que son un par.
- El endpoint `GET` de cuenta corriente devuelve los tres campos nuevos.

---

## Slice 3 — Reparaciones express (PR3)

Tres piezas, ninguna invasiva.

### 3.1 RPC `crear_reparaciones_express`

Modelada sobre `crear_recepcion_multiple` (`supabase/migrations/288_crear_recepcion_multiple.sql`), que ya resolvió el mismo problema de N inserciones atómicas.

```
crear_reparaciones_express(
  p_organization_id TEXT,
  p_sucursal_id     TEXT,
  p_cliente_id      TEXT,
  p_reparaciones    JSONB,   -- [{dispositivo, tipoDispositivo, marca, imei,
                             --   trabajoRealizado, precio, publicToken,
                             --   diasGarantia, fechaVencimientoGarantia}]
  p_operador_id     TEXT,    -- operador atribuido (resolveOperador) → recibido_por
  p_created_by      TEXT     -- usuario autenticado → entregado_por_user_id, auditoría
) RETURNS JSONB
```

Dentro de una sola transacción, por cada reparación:

1. Resuelve `prefijo_orden` desde `tipos_dispositivo` (fallback `'ORD'`) y toma número con `get_next_order_number(p_organization_id)` — contador atómico con row lock, **no** `MAX+1`, por la misma razón documentada en la migración 288: dos terminales de mostrador concurrentes colisionarían contra el `UNIQUE`.
2. Inserta en `ordenes_servicio` con `estado = 'ENTREGADO'`, `costo_final = precio`, `total_cobrado = 0`, `fecha_entrega = NOW()`, `entregado_por_user_id = p_created_by`, `recibido_por = p_operador_id`, `problema_reportado = trabajoRealizado`, `public_token`, `sucursal_id`, `cliente_id`.
3. Inserta `orden_eventos` con `tipo='CAMBIO_ESTADO'`, `estado_nuevo='ENTREGADO'` y una descripción explícita de que es una reparación express sin recepción — para que el timeline público no muestre un salto inexplicable.
4. Si `diasGarantia > 0`, inserta en `garantias` con `fecha_vencimiento` **ya calculada por la app** (ver 3.2, punto 8).
5. Llama a `cargar_deuda_cuenta_corriente(p_org_id, p_cliente_id, precio, 'ORDEN', v_orden_id, p_created_by, p_sucursal_id)` — firma vigente en `supabase/migrations/268_cuenta_corriente_sucursal_writers.sql:34-42`.

Devuelve `{ ordenes: [{id, numeroOrden, codigoOrden, dispositivo, precio, publicToken, movimientoId}], totalCargado, saldoNuevo }`. El `movimientoId` viaja al cliente para que el modal de éxito pueda ofrecer "revertir el lote" sin una consulta extra.

Dos propiedades caen gratis de la transacción compartida, igual que en la 288:

- el trigger `update_ordenes_count` (`supabase/migrations/167_atomic_plan_limit_enforcement.sql`) rollbackea el lote entero si la organización excede el límite de órdenes de su plan;
- los `cargar_deuda_cuenta_corriente` secuenciales toman `FOR UPDATE` sobre la fila del cliente dentro de la misma transacción, así que la cadena de `saldo_posterior` queda consistente y sin race con otra terminal.

### 3.2 `POST /api/reparaciones-express`

Responsabilidades del endpoint, todas por analogía directa con `app/api/recepciones/route.ts`:

1. `requireAdminOrVendedor()`.
2. Gate de plan: `hasPlanFeature(organizationId, "reparaciones_express")`; si no, 403 con `code: "FEATURE_REQUIRED"`.
3. `enforcePlanLimit(organizationId, "ordenes")` — son órdenes reales y cuentan para el límite.
4. Validación Zod: mínimo 1 reparación, `precio > 0`, `dispositivo`, `tipoDispositivo` y `trabajoRealizado` requeridos.
5. Validación de IMEI por tipo: `tipoValidaImei` + `isValidImei`, idéntica a recepciones (`app/api/recepciones/route.ts:78-88`).
6. `sucursalParaEscritura` y `resolveOperador`.
7. `publicToken` por reparación con `randomBytes(16)` en la app — la base no depende de `pgcrypto`, criterio ya establecido en la 288.
8. **Cálculo de `fecha_vencimiento` de garantía en la app**, con `addDaysInTimeZone(dias, org.zona_horaria)`, igual que `entregar/route.ts:224`. La zona horaria del taller vive en `organizations.zona_horaria` y el vencimiento es un día calendario, no un instante; calcularlo en SQL con `NOW() + interval` daría el día equivocado para talleres fuera de UTC.
9. **Idempotencia obligatoria.** El request acepta `idempotencyKey`; un doble submit no puede duplicar deuda. Reusa la barrera `pago_idempotency` que ya protege cobros y ventas (`app/api/ordenes/[id]/cobros/route.ts:26-29`). Esto es dinero: sin la barrera, un doble click con red lenta le carga al cliente el lote dos veces.
10. Auditoría: `audit.create("ordenes_servicio", ...)` por orden, más un registro del lote.

### 3.3 UI

- Botón de disparo junto al panel de cuenta corriente en `components/clientes/detalle/cliente-detalle.tsx`. El cliente ya está resuelto por contexto: no hay selector de cliente.
- Diálogo `components/clientes/detalle/reparaciones-express-dialog.tsx` con tabla editable de filas. Por fila: `dispositivo*`, `tipoDispositivo*` (select desde `tipos_dispositivo` activos), `marca`, `imei`, `trabajoRealizado*`, `precio*`, `diasGarantia`.
- Total del lote en vivo y saldo resultante del cliente (`saldo_cuenta - total`), visible antes de confirmar.
- Confirmación explícita con el total y el saldo al que queda el cliente.
- Modal de éxito con las órdenes creadas, link a cada una y acción **Revertir lote** (Slice 2), útil justo cuando el error se acaba de cometer y todavía está a la vista.

**Gotcha conocido de la app:** si alguna fila usa un `Select` de Radix seteado desde afuera con el dropdown cerrado, el valor se borra. Está documentado para inventario y afecta a toda la app. El select de tipo de dispositivo de este formulario debe setearse solo por interacción del usuario, o llevar el mismo guard.

### 3.4 Modelo de datos

**Ninguna columna nueva** en este slice. La migración contiene:

1. la función `crear_reparaciones_express`;
2. el alta del feature flag `reparaciones_express` en los planes Profesional y Pro, con el patrón de `supabase/migrations/287_recepcion_multiple.sql`.

Se usa un flag propio y **no** se reusa `recepcion_multiple`: son features independientes y un taller podría querer una sin la otra. El costo de separarlas es una línea de `UPDATE` en la migración.

### 3.5 Errores y bordes

| Caso | Comportamiento |
|---|---|
| Cliente inexistente o de otra organización | `cargar_deuda_cuenta_corriente` levanta `Cliente no encontrado` → rollback del lote, 404 |
| Límite de órdenes del plan excedido a mitad del lote | El trigger rollbackea todo; se devuelve `planLimitErrorResponse` |
| IMEI inválido para un tipo que lo exige | 400 antes de tocar la base, nombrando el equipo de la fila |
| Doble submit / retry offline | La barrera de idempotencia devuelve el resultado original; no se duplica deuda |
| Plan sin la feature | 403 `FEATURE_REQUIRED` |
| `tipos_dispositivo` sin prefijo configurado | Fallback `'ORD'`, igual que la 288 |
| Cliente con saldo a favor | El `CARGO` lo consume: `saldo_posterior` puede quedar positivo. Es correcto y es la semántica existente |

---

## Testing

Strict TDD activo: test primero, en rojo, antes de cada pieza.

**Slice 1** (`__tests__/api/deuda-cliente-sucursal.test.ts`)
- orden entregada a fiado: la deuda total deja de duplicarse;
- orden con cobro parcial + entrega: la deuda total es exactamente el pendiente, ni más ni menos;
- orden con pendiente y sin `CARGO`: sigue contando (degradación correcta ante el `cargar_deuda` que falla silencioso);
- orden no entregada con costo: sin cambios;
- el filtro por `sucursal_id` sigue funcionando igual.

**Slice 2** (`__tests__/api/cc-revertir-cargo.test.ts`, patrón de `__tests__/api/cc-reversibilidad.test.ts`)
- revierte un `CARGO` de orden y el saldo del cliente vuelve exactamente al valor previo;
- doble reversa del mismo movimiento → 400, sin segundo `DEVOLUCION`;
- rechaza `DEPOSITO`, `PAGO`, `AJUSTE` y `CARGO` con `referencia_tipo` distinto de `ORDEN`;
- rechaza movimiento de otro cliente o de otra organización;
- rol distinto de ADMIN → 403;
- reversa de lote: si un movimiento del array es inválido, no se revierte ninguno;
- el `DEVOLUCION` hereda el `sucursal_id` del `CARGO` original, no el del operador.

**Slice 3** (`__tests__/api/reparaciones-express.test.ts`, patrón de `__tests__/api/cc-fiado.test.ts`)
- crea N órdenes en `ENTREGADO` con `costo_final` correcto;
- genera exactamente N movimientos `CARGO`, uno por orden, con `referencia_tipo='ORDEN'`;
- `saldo_posterior` encadena correctamente a lo largo del lote;
- fallo en la reparación k rollbackea las k-1 anteriores y sus cargos;
- doble submit con la misma `idempotencyKey` no duplica deuda;
- 403 sin feature de plan; 400 con IMEI inválido; rol no autorizado rechazado.

**Regresión**
- `lib/__tests__/orden-state-machine.test.ts`: `TRANSICIONES_VALIDAS` no cambia; `RECIBIDO → ENTREGADO` sigue siendo inválida.
- Sin cambios de comportamiento en `app/api/recepciones/route.ts` ni en `app/api/ordenes/[id]/entregar/route.ts`.

**Cierre obligatorio de cada PR**
- `npx tsc --noEmit` limpio. Lint verde no chequea tipos, y en este repo eso ya rompió un build con la suite entera en verde.
- Para lint, `npx eslint <dirs>` acotado: `npm run lint` recorre los worktrees y no termina.

## Plan de entrega

Tres PRs encadenados, en este orden. La dependencia es real, no de conveniencia.

| PR | Contenido | Depende de |
|---|---|---|
| PR1 | Migración del fix de doble conteo + tests + consulta de verificación previa | — |
| PR2 | Columnas de reversa + RPC `revertir_cargos_orden` + endpoint + UI en el panel + tests | PR1 (la regla "orden con `CARGO` sale de `deuda_ordenes`" es lo que hace útil la reversa) |
| PR3 | Migración `crear_reparaciones_express` + feature flag + endpoint + diálogo + tests | PR2 (el lote nace con su reversa disponible) |

Las migraciones se numeran al mergear, no al crear la branch. Se aplican a mano con `scripts/db-run.mjs`, un archivo por vez, dry-run primero.

## Riesgos

1. **Efecto visible del PR1.** La deuda de los clientes con fiado baja a la mitad en la pantalla y en el recordatorio de WhatsApp. Es el número correcto, pero un taller que no esté avisado va a leerlo como que "se le perdió plata". El PR lleva la consulta de verificación previa para poder cuantificarlo antes de aplicar.
2. **Métricas de órdenes.** Las órdenes express entran en los conteos de órdenes entregadas y en el límite del plan. Un taller que cargue muchos lotes verá su métrica de "entregadas" inflada respecto de su trabajo de taller real. Se acepta: son trabajos reales, solo que sin ciclo.
3. **Timeline con un solo evento.** El seguimiento público de una orden express muestra un único evento. Es correcto, pero conviene que el texto lo explique en lugar de parecer un dato faltante.
4. **La reversa borra la deuda de los dos lados.** Por la regla del Slice 1, revertir el `CARGO` de una orden deja esa orden sin contar en ningún cálculo de deuda. Es exactamente lo que "revertir" significa, pero no tiene vuelta atrás por UI. Mitigación: solo ADMIN, motivo obligatorio, auditoría y el par `CARGO`/`DEVOLUCION` visible en el panel.

## Fuera de alcance

- Comprobante impreso del lote. v1 usa lo que ya existe: comprobante por orden y el resumen de cuenta corriente en PDF (`app/api/clientes/[id]/cuenta-corriente/resumen/route.ts`). Si el taller pide un papel único del lote, se evalúa después con uso real.
- Cobro parcial o total en el momento de cargar el lote.
- Anulación genérica de movimientos de cuenta corriente (`DEPOSITO`, `PAGO`, `AJUSTE`).
- Notificación de WhatsApp por el lote.
