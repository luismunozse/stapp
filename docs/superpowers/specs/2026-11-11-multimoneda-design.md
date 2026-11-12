# Multimoneda: precios en moneda local y en USD o EUR (fase 1)

Fecha: 2026-11-11 · Estado: diseño aprobado en chat, pendiente de revisión del spec

## 1. Contexto

STApp opera en una sola moneda por organización (`organizations.moneda`). Los comercios
(sobre todo en Argentina) compran y piensan muchos precios en dólares, y hoy tienen que
recalcular a mano el precio local cada vez que se mueve la cotización.

En octubre de 2026 se empezó el cambio "multimoneda-inventario-servicios" y se mergearon dos
fases, sin wiring a la UI:

- **S1, #509:** `365_multimoneda_foundation.sql` + `365b_multimoneda_validate.sql`. La tabla
  `organizacion_moneda`, la columna `moneda` en `inventario`, `servicios` y `movimientos_caja`,
  la foto `moneda_origen / precio_origen / tipo_cambio` en las líneas, `tipo_cambio` y
  `tipo_cambio_fuente` en `ventas` y `ordenes_servicio`, los pagos en divisa y
  `sesion_caja_saldos`. Los CHECK fuerzan `'USD'`.
- **S2, #510:** `lib/currency/convert.ts` (validación de la cotización, redondeo por unidad,
  conversión antes del recargo) y `lib/currency/config-moneda.ts` (resolución de la
  configuración por país).

El spec original de esas fases se perdió. Este documento lo reemplaza; los requisitos que el
código ya cita (`REQ-1.6`, `REQ-3.2`) conservan su número y su sentido.

En cotizaciones existe desde la migración 082 un `items_cotizacion.moneda_item`, que ningún
código usa, y un campo libre `cotizaciones.tipo_cambio` en el formulario. Ambos se reemplazan
por este modelo.

## 2. Decisiones

| # | Decisión |
|---|---|
| D1 | Cada organización tiene **una** moneda extranjera, USD **o** EUR, además de la local. Una organización con moneda local USD puede usar EUR. |
| D2 | **Fase 1 = precio de referencia.** El cliente siempre paga en moneda local. Los pagos en divisa, la caja y el arqueo por moneda son la fase 2 (el esquema ya existe en la 365 y no se toca acá). |
| D3 | Alcance de la fase 1: configuración, inventario (variantes y kits incluidos), servicios, POS/ventas, órdenes y cotizaciones. Quedan para después: import CSV con columna de moneda y comprobantes/PDF con el detalle de la conversión. |
| D4 | **Una sola cotización por documento, siempre**, para órdenes, cotizaciones y lo que se crea desde una cotización, sin importar cuántos ítems tenga. Se fija con la primera línea en divisa y solo cambia con la acción explícita "Cambiar cotización" (cotización de hoy, o valor manual con motivo obligatorio). |
| D5 | Enfoque: conversión por línea con la foto de origen. Los montos de siempre (`precio_unitario`, `subtotal`, `total`, `costo_unitario_snapshot`, `monto`) **siempre están en moneda local**. La divisa vive solo en el catálogo y en la foto de origen de cada línea. Caja, cuenta corriente, comisiones, reportes y ARCA no cambian. |

Enfoques descartados: precio dual sincronizado por cron (cambia los precios sin que nadie lo
decida, no deja trazabilidad y contradice D4) y documentos en moneda extranjera (obliga a
reescribir caja, cuenta corriente, comisiones, reportes y ARCA).

## 3. Requisitos

### REQ-1 Configuración y cotización

- **REQ-1.1** La sección "Moneda extranjera" en Configuración → Operativa la edita solo el
  ADMIN. Campos: habilitada, moneda extranjera (USD/EUR), fuente, cotización manual y redondeo
  de la conversión. Muestra la cotización vigente con su fuente y su hora.
- **REQ-1.2** Fuentes disponibles: AR + USD → MANUAL, OFICIAL, BLUE, MEP (por defecto BLUE).
  AR + EUR → MANUAL, OFICIAL (por defecto OFICIAL). Otros países → MANUAL.
- **REQ-1.3** La moneda extranjera no puede ser igual a la local (400).
- **REQ-1.4** Redondeo de la conversión: 0, 1, 10 o 100. Por defecto 10 en AR; en el resto 0,
  o 1 si la moneda local no tiene decimales (comportamiento actual de `config-moneda.ts`).
- **REQ-1.5** `GET /api/moneda/tipo-cambio` devuelve
  `{ valor, fuente, moneda, en, estado: "vivo" | "referencia" }`. Con fuente MANUAL devuelve la
  cotización manual. Con OFICIAL/BLUE/MEP usa el valor de **venta** de dolarapi
  (`/v1/dolares/{casa}`; EUR oficial: `/v1/cotizaciones/eur`) con caché de 5 minutos. Cada
  lectura en vivo correcta actualiza `tipo_cambio_referencia` y `referencia_en`.
- **REQ-1.6** Una cotización es un número finito, mayor que 0, menor que 1e8, en notación
  decimal simple y con hasta 6 decimales (`validarTipoCambio`; la columna es `NUMERIC(14,6)`).
- **REQ-1.7** Si la fuente en vivo falla, se usa la referencia con `estado: "referencia"`, y la
  UI muestra "Cotización de hace X h". Si la referencia no existe o tiene más de 24 h, no hay
  cotización: ver REQ-6.1.
- **REQ-1.8** Las rutas y las RPC resuelven la cotización en el servidor. La cotización que
  envía el navegador solo sirve para detectar que cambió (REQ-3.4).
- **REQ-1.9** Apagar la función se permite. Antes, una advertencia muestra cuántos productos y
  servicios tienen precio en divisa. Nada se convierte automáticamente.

### REQ-2 Catálogo

- **REQ-2.1** Inventario y servicios tienen un selector "Moneda del precio" (local / divisa
  de la org), visible solo con la función activa. La moneda aplica a la vez al precio de venta
  y al de compra (`inventario.moneda`, `servicios.moneda`; NULL = local).
- **REQ-2.2** Debajo de cada precio en divisa se muestra el equivalente estimado: "≈ $60.000
  hoy (Blue, 1.200)".
- **REQ-2.3** Al cambiar la moneda de un ítem que ya tiene precio, el formulario pregunta si
  **convertir** con la cotización vigente o **mantener el número**.
- **REQ-2.4** Toda ruta de alta (formulario, import, alta masiva, onboarding/seed, API v1)
  escribe `moneda` de forma explícita; sin elección del usuario, NULL (local).
- **REQ-2.5** El listado muestra el precio en su moneda ("US$ 50") con el equivalente local
  debajo, y un filtro de moneda (todas / local / divisa).
- **REQ-2.6** La valuación de stock (tarjetas, análisis ABC) convierte con la cotización
  vigente y se marca "≈". Sin cotización, excluye esos ítems e informa cuántos quedaron afuera.
- **REQ-2.7** Variantes: heredan la moneda del producto padre al crearse. Un grupo no mezcla
  monedas; cambiar la del padre cambia la de todo el grupo.
- **REQ-2.8** Kits: tienen moneda y precio propios. `calcular_costo_kit` convierte a moneda
  local los componentes en divisa antes de sumar; sin cotización, el costo es "no disponible".
- **REQ-2.9** El ajuste masivo de precios (%) aplica en la moneda de cada ítem, y la vista
  previa muestra la moneda. El import de precios interpreta cada precio en la moneda actual
  del ítem y no la cambia.
- **REQ-2.10** La API v1 y los webhooks de inventario y servicios exponen `moneda` (aditivo).

### REQ-3 Conversión y POS

- **REQ-3.1** En las líneas que vienen del catálogo, el servidor toma `moneda` y el precio de
  origen **del ítem**, no del request.
- **REQ-3.2** Orden normativo: (1) conversión de la línea en divisa,
  `roundUnit(origen × tc, redondeo)`; (2) recargo por medio de pago; (3) descuentos por línea y
  global; (4) IVA; (5) redondeo de efectivo sobre el total. Implementado en
  `calcularTotalesMultimoneda`. Una venta sin líneas en divisa da exactamente lo mismo que
  `calcularTotalesVenta`.
- **REQ-3.3** Cada línea en divisa guarda `moneda_origen`, `precio_origen` y `tipo_cambio`.
  `precio_unitario` y `costo_unitario_snapshot` se guardan en moneda local; el costo se
  convierte con la misma cotización y el mismo redondeo.
- **REQ-3.4** El POS muestra la cotización en uso (chip con fuente y antigüedad) y "US$ 50 →
  $60.000" por línea. Al confirmar envía `tipoCambio`; si difiere de la que resuelve el
  servidor, la respuesta es **409** con la anterior y la nueva, y el POS recalcula y pide
  reconfirmar.
- **REQ-3.5** La venta guarda `ventas.tipo_cambio` y `tipo_cambio_fuente`.
  `crear_venta_atomica` (M2) recibe y persiste los campos de origen por ítem; no calcula.
- **REQ-3.6** Editar el precio de una línea en divisa en el POS se hace en la divisa y se
  reconvierte.
- **REQ-3.7** Los ítems en divisa no se pueden agregar sin cotización (REQ-6.1) ni con la
  función apagada (REQ-6.3).

### REQ-4 Órdenes de servicio

- **REQ-4.1** `ordenes_servicio.tipo_cambio` (y `tipo_cambio_fuente`) se fija con la primera
  línea en divisa, usando la cotización vigente. Las líneas siguientes usan **la de la orden**.
- **REQ-4.2** `add_repuesto_inventario` y `agregar_servicio_orden` reciben
  `p_tipo_cambio` (y el redondeo) desde la ruta y persisten la foto de origen; el costo del
  repuesto se convierte como en REQ-3.3.
- **REQ-4.3** Repuestos y servicios manuales se cargan en moneda local, salvo que el usuario
  elija la divisa en el diálogo; en ese caso usan la cotización de la orden.
- **REQ-4.4** Invariante: toda línea en divisa de una orden tiene `tipo_cambio` igual al de la
  orden.
- **REQ-4.5** "Cambiar cotización" (detalle de la orden) está visible si hay líneas en divisa
  y la orden no está entregada ni cobrada por completo. Tiene dos modos: **hoy** (cotización
  vigente) o **manual** (valor + motivo obligatorio). Muestra una vista previa
  (TC y total, antes → después), recalcula todas las líneas en divisa a partir de
  `precio_origen` (nunca a partir del local anterior), actualiza la orden, registra el cambio en
  `recotizaciones` y en los eventos de la orden. Los cobros ya registrados no cambian; cambia el
  saldo.

### REQ-5 Cotizaciones

- **REQ-5.1** Se elimina el campo libre "Tipo cambio USD". `cotizaciones.tipo_cambio` sigue
  REQ-4.1 y REQ-4.4 (una por documento) y se agregan `tipo_cambio_fuente` y `tipo_cambio_en`.
- **REQ-5.2** Las líneas desde el catálogo traen su moneda y se convierten como en REQ-3.
  `items_cotizacion.moneda_item` queda obsoleto: no se lee ni se escribe.
- **REQ-5.3** "Cambiar cotización" funciona como REQ-4.5, solo en los estados BORRADOR y
  ENVIADA. ACEPTADA, RECHAZADA, VENCIDA y convertida quedan congeladas.
- **REQ-5.4** Convertir una cotización en venta u orden **hereda su cotización**: el documento
  nuevo usa el mismo `tipo_cambio` y las mismas líneas convertidas, y no consulta la del día.
  En la conversión a venta no se aplica el control 409 de REQ-3.4.
- **REQ-5.5** El link público y el PDF muestran solo moneda local en la fase 1.

### REQ-6 Errores

- **REQ-6.1** Sin cotización disponible (REQ-1.7): no se pueden agregar líneas en divisa. El
  mensaje enlaza a Configuración para cargar una manual. Las líneas en moneda local no se ven
  afectadas.
- **REQ-6.2** Una cotización manual inválida devuelve 400 con el mensaje de `validarTipoCambio`.
- **REQ-6.3** Con la función apagada, los ítems en divisa se ven deshabilitados en el POS y en
  los diálogos de orden y cotización, con el motivo.
- **REQ-6.4** "Cambiar cotización" sobre un documento en estado no permitido → 409.
  Sin motivo en modo manual → 400.
- **REQ-6.5** Si la migración 399 no está aplicada (42703/42P01 al leer
  `organizacion_moneda.moneda_extranjera`), la función se considera apagada: no hay errores 500.
- **REQ-6.6** Nunca se convierte con 0, con un valor vacío ni con un precio de origen inválido
  (`PrecioOrigenInvalidoError` / `TipoCambioInvalidoError`, ya implementados en S2).

## 4. Modelo de datos: migración 399

Aditiva, re-ejecutable y con el mismo estilo que la 365 (CHECK `NOT VALID`, `lock_timeout`,
aplicar fuera de hora pico). Incluye rollback y probes.

1. Reemplaza los CHECK `= 'USD'` por `IN ('USD','EUR')` en `inventario`, `servicios`,
   `items_venta`, `servicios_orden`, `repuestos_orden` e `items_cotizacion`. **No** toca
   `pagos_venta`, `movimientos_caja` ni `sesion_caja_saldos` (fase 2).
2. `organizacion_moneda.moneda_extranjera CHAR(3) NOT NULL DEFAULT 'USD'`, con CHECK
   `IN ('USD','EUR')`.
3. `cotizaciones.tipo_cambio_fuente TEXT` y `cotizaciones.tipo_cambio_en TIMESTAMPTZ`.
   El `tipo_cambio DECIMAL` existente se convierte a `NUMERIC(14,6)` solo si no hay valores
   fuera de rango; si no se puede, se deja como está y la validación queda en el código.
4. Una tabla nueva, `recotizaciones`:
   `id`, `organization_id`, `documento_tipo` (`ORDEN` | `COTIZACION`), `documento_id`,
   `modo` (`HOY` | `MANUAL`), `tipo_cambio_anterior`, `tipo_cambio_nuevo`, `motivo`,
   `total_anterior`, `total_nuevo`, `lineas_afectadas`, `usuario_id`, `created_at`. RLS con la
   misma forma que la 365 (SELECT de la propia org para authenticated, todo para service_role).
5. Las RPC `crear_venta_atomica`, `add_repuesto_inventario`, `agregar_servicio_orden` y
   `calcular_costo_kit` se redefinen en migraciones propias de cada entrega (S4–S6), no en
   la 399.

Estado en producción (verificado el 2026-11-11 con una consulta de solo lectura): **la 365 y
la 365b NO están aplicadas**: no existen `organizacion_moneda` ni `sesion_caja_saldos`, ni
ninguna de las columnas o CHECK de la 365. Por eso S3 aplica primero la 365 y la 365b y después
la 399, fuera de hora pico, porque la 365 toma ACCESS EXCLUSIVE sobre tablas muy usadas. Como
la 365 nunca se aplicó, el plan de S3 evalúa corregirla directamente (EUR, `moneda_extranjera`)
en lugar de crear CHECK que la 399 borra enseguida. Verificación posterior:
`verify/365_probes.sql` y `verify/399_probes.sql`.

## 5. Componentes

| Unidad | Responsabilidad |
|---|---|
| `lib/currency/convert.ts` (existe) | Conversión pura y orden REQ-3.2. Se generaliza `MonedaExtranjera` a `"USD" \| "EUR"`. |
| `lib/currency/config-moneda.ts` (existe) | Agrega `monedaExtranjera`, fuentes según moneda (REQ-1.2), y deja de apagar la función cuando la moneda local es USD. |
| `lib/currency/tipo-cambio.server.ts` (nuevo) | Resolvedor de la cotización: manual / vivo / referencia / sin cotización (REQ-1.5, 1.7). Única fuente del número para rutas y RPC. |
| `lib/currency/recotizar.ts` (nuevo, puro) | Recalcula las líneas de un documento desde `precio_origen` con una cotización nueva; devuelve las líneas y los totales antes y después. |
| `app/api/moneda/tipo-cambio` (nuevo) | Endpoint REQ-1.5. |
| `app/api/configuracion/moneda` (nuevo) | GET/PUT de `organizacion_moneda` (no se suma otro escalón a las cascadas de `/api/configuracion`). |
| `app/api/{ordenes,cotizaciones}/[id]/cotizacion-cambio` (nuevo) | POST "Cambiar cotización" (REQ-4.5, 5.3). |
| `hooks/use-moneda.ts` (nuevo) | Configuración + cotización vigente para la UI (formularios, POS, listados). |
| `components/moneda/*` (nuevo) | Selector de moneda, chip de cotización, "≈ equivalente", diálogo "Cambiar cotización". |

## 6. Entregas

Cada una es un PR propio. Todo queda apagado detrás de `multimoneda_habilitada` hasta que
termine S5.

1. **S3:** aplicar 365 + 365b (nunca se aplicaron) y la migración 399, `config-moneda` (EUR), resolvedor y endpoint de cotización, pantalla
   de configuración.
2. **S4:** catálogo (formularios, listado, valuación, variantes, kits, ajuste masivo, import,
   API v1).
3. **S5:** POS + `/api/ventas` + `crear_venta_atomica` (M2) + control 409.
4. **S6:** órdenes (RPC de repuestos y servicios) + "Cambiar cotización" + eventos.
5. **S7:** cotizaciones (formulario, conversión, "Cambiar cotización", convertir a venta u
   orden).

## 7. Pruebas

- **Unitarias:** `config-moneda` con EUR y con local USD + EUR; resolvedor (vivo → referencia
  → bloqueo, límite de 24 h); `recotizar` (desde `precio_origen`, sin redondeo acumulado,
  modo manual con motivo); conversión del costo.
- **Rutas (mocks de Supabase):**
  - `/api/ventas`: el precio sale del catálogo y no del cliente, 409 por cotización
    distinta, costo convertido.
  - Repuestos y servicios de orden: la primera línea fija la cotización y las siguientes la
    heredan (REQ-4.4).
  - "Cambiar cotización": sus dos modos y los bloqueos por estado.
  - Convertir una cotización hereda su cotización.
- **Migración:** test estático del SQL (como `multimoneda-fundacion-migration.test.ts`),
  `verify/399_probes.sql` y `rollback/399_rollback.sql`.
- **Regresión:** una venta y una orden sin líneas en divisa dan los mismos totales que hoy
  (fixtures compartidos en `fixtures/currency/`).
- **E2E (Playwright):** activar USD manual → producto en USD → venta en el POS → total y foto
  guardada correctos.

## 8. Fuera de alcance (fase 2 y siguientes)

- Cobros en divisa, vuelto, caja y arqueo por moneda (`pagos_venta.moneda`,
  `sesion_caja_saldos`).
- Columna de moneda en el import CSV y en el alta masiva.
- Comprobantes, PDF y link público con el detalle "US$ 50 × 1.200".
- Deuda de cuenta corriente indexada a la divisa.
- Más de una moneda extranjera por organización.
