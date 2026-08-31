# Separación de proveedor de email: Resend para el mail al cliente del taller

**Fecha:** 2026-08-31
**Branch:** `feat/email-provider-split`

## Problema

Todo el correo de STApp sale por un único proveedor (EnvialoSimple), con una
sola API key y una sola dirección remitente `noreply@stapp.com.ar`
(`lib/email.ts:5-6`). Por ese mismo remitente salen, mezclados:

- Correo de plataforma crítico: verificación de cuenta, reset de contraseña,
  facturación, webhook de MercadoPago, leads, soporte.
- Correo operativo del taller hacia su cliente final: cambios de estado de
  orden, presupuesto definido, recordatorio de retiro, garantías, cobranza.

Esto produce tres problemas concretos:

1. **Reputación acoplada.** El correo operativo tiene volumen alto y va a
   destinatarios que nunca hicieron opt-in explícito. Un pico de rebotes o
   quejas degrada la reputación del dominio, y lo primero que deja de llegar
   es la verificación de cuenta y el reset de contraseña: los correos sin los
   cuales nadie puede entrar al sistema.

2. **Sin techo de costo separado.** No hay forma de acotar el gasto ni los
   límites del canal operativo sin afectar al de plataforma.

3. **Sin estado de entrega.** `notification_logs` registra cada intento, pero
   `estado` sólo distingue `ENVIADO` / `FALLIDO` / `PENDIENTE`, y `ENVIADO`
   significa "el proveedor aceptó el POST", no "el correo llegó". Nadie vuelve
   a tocar la fila. No hay eventos de entrega, rebote ni queja, y no existe
   lista de supresión.

## Objetivo

Enrutar el correo dirigido al **cliente final del taller** por un proveedor
propio (Resend) sobre un **subdominio propio**, con seguimiento de entrega y
supresión automática de direcciones muertas. El correo de plataforma sigue
íntegro en EnvialoSimple.

**No-goals (YAGNI):**

- Remitente propio por taller (dominio verificado por organización). Descartado
  explícitamente: la dirección sigue siendo de STApp, sólo cambia el nombre
  visible.
- Cola de reintentos para envíos fallidos.
- Seguimiento de aperturas y clics.
- Migrar el correo de plataforma a Resend.
- Refactorizar las 5 copias restantes de la llamada a EnvialoSimple
  (4 crons + webhook de MercadoPago). Queda como deuda documentada.

## Decisión de proveedor

Resend sobre Brevo, por tres razones en orden de peso:

1. **Menor superficie.** Resend es sólo API transaccional. Brevo es una suite de
   marketing y CRM con la API transaccional adosada; su ventaja declarada
   —un webhook unificado para marketing y transaccional— es inútil acá, porque
   el marketing y el lifecycle se quedan en EnvialoSimple. Menos features es
   menos formas de mandar algo por el canal equivocado, y el aislamiento es el
   driver principal.
2. **Cabeza de pista por dólar.** Resend Pro: USD 20/mes por 50.000 envíos.
   Brevo arranca en USD 9 por 5.000, pero llega a USD 18 en 20.000 — paridad
   antes de la mitad del volumen incluido en Resend.
3. **Mejor webhook.** Firma Svix, reintentos y payload estable.

Donde Brevo habría ganado: si el volumen se mantuviera por debajo de 9.000/mes
y de 300/día, su plan gratuito lo cubre y Resend cobraría USD 20. El volumen
real no es medible hoy (ver "Riesgos conocidos").

**Advertencia central:** cambiar de proveedor **no aísla reputación por sí
solo**. La reputación se computa por IP *y* por dominio de envío. El
aislamiento lo da el subdominio dedicado `avisos.stapp.com.ar` con SPF, DKIM y
DMARC propios. Resend es el vehículo; el subdominio es el aislamiento.

## Frontera de ruteo

| Proveedor | Dominio | Alcance |
|---|---|---|
| **Resend** | `avisos.stapp.com.ar` | Notificaciones al cliente final del taller (los tipos de `NotificationType`) |
| **EnvialoSimple** | `stapp.com.ar` | Verificación, reset de contraseña, facturación, webhook de MercadoPago, 4 crons de lifecycle, leads, soporte, cotizaciones |

## Arquitectura

```
lib/email/
  types.ts                      EmailMessage, SendResult, EmailProvider
  providers/envialosimple.ts    el fetch actual, movido sin cambios de conducta
  providers/resend.ts           nuevo
  index.ts                      sendPlatform() | sendCustomer()

lib/email.ts                    plantillas intactas; su sendEmail interno pasa a sendPlatform()
lib/notifications/send-direct.ts:92   sendEmail() -> sendCustomer()   [camino vivo]
lib/notifications/index.ts:96         sendEmail() -> sendCustomer()   [segundo camino]
```

### El ruteo es explícito

Dos funciones con nombre (`sendPlatform`, `sendCustomer`) en lugar de un `send()`
genérico que decida el proveedor inspeccionando el tipo de mensaje. Si alguien
enruta un reset de contraseña por `sendCustomer`, se ve en el diff. Un router
que adivina es precisamente el mecanismo por el cual el correo termina saliendo
por el canal equivocado.

### Dos caminos de envío, no uno

`lib/notifications/` tiene **dos** rutas de correo al cliente:

- `sendNotificationDirect` (`lib/notifications/send-direct.ts:92`), invocada por
  `queueNotification` (`lib/notifications/queue.ts:62`). **Este es el camino
  vivo en producción.**
- `NotificationService.sendEmail` (`lib/notifications/index.ts:96`). De esta
  clase la API sólo consume `getNotificationHistory`.

Ambos deben cambiar. Modificar únicamente `index.ts` no alteraría nada en
producción y el deploy pasaría verde igual.

`sendNotificationDirect` se invoca **fire-and-forget** desde las API routes
(`lib/notifications/queue.ts:6`): un correo que falla nunca bloquea el cambio de
estado de la orden. Esa conducta se preserva sin cambios.

### Remitente

Hoy `lib/email.ts:176` arma `${fromName} <noreply@stapp.com.ar>`. En el canal de
cliente pasa a `${nombreTaller} <avisos@avisos.stapp.com.ar>`: dirección de
STApp, nombre visible del taller. Coherente con haber descartado el remitente
propio por organización.

### Variables de entorno

```
RESEND_API_KEY
RESEND_FROM=avisos@avisos.stapp.com.ar
RESEND_WEBHOOK_SECRET
```

### Kill switch

Si `RESEND_API_KEY` no está definida, `sendCustomer()` cae a EnvialoSimple. Esto
permite desplegar el código apagado, verificar el subdominio sin apuro y activar
cargando la variable. Ausencia de key nunca equivale a correo perdido.

**Regla estricta:** la caída a EnvialoSimple ocurre **sólo por configuración
ausente**, nunca por un envío fallido. Ver "Manejo de errores".

**El chequeo de supresión corre igual durante el fallback.** La lista de
supresión describe direcciones muertas o que se quejaron, un hecho del
destinatario y no del proveedor. Enviar a una casilla suprimida por EnvialoSimple
degradaría el dominio de plataforma, que es exactamente lo que este cambio busca
proteger. El orden es: consultar supresión, luego elegir proveedor.

## Modelo de datos

### Migración 321

El 320 lo ocupa `vendedores_manejan_caja`, aplicada el 2026-08-30.

**a) Enum `estado_notificacion`.** Hoy `('ENVIADO','FALLIDO','PENDIENTE')`.
Agrega `ENTREGADO`, `REBOTADO`, `QUEJA`.

> El `ALTER TYPE ... ADD VALUE` va en una query separada, y el valor nuevo no
> puede *usarse* en la misma transacción que lo declara. Si se agrupa con el
> resto del archivo, el enum no queda. Mismo problema que apareció en la 316/317.

**b) Columnas nuevas en `notification_logs`:**

```sql
provider_message_id TEXT           -- clave de correlación con el webhook
proveedor           TEXT NOT NULL DEFAULT 'envialosimple'
delivered_at        TIMESTAMPTZ
bounced_at          TIMESTAMPTZ
bounce_tipo         TEXT           -- HARD | SOFT | QUEJA
```

`bounced_at` y `bounce_tipo` cubren también la queja por spam, con
`bounce_tipo='QUEJA'`. Es deliberado: son el mismo evento desde el punto de
vista operativo —el proveedor informa que esta dirección no debe recibir más
correo— y duplicar el par de columnas sólo para la queja agregaría estado sin
agregar información.

Con índice sobre `provider_message_id`. Hoy el identificador del proveedor vive
dentro de `metadata`, que es `TEXT` y no `JSONB`: no es indexable, y el webhook
haría un full scan por cada evento recibido.

`proveedor` es necesaria durante el despliegue apagado: con el kill switch
activo, la misma tabla contiene filas de ambos proveedores. `send-direct.ts:112`
ya escribe `provider: "envialosimple"` dentro de `metadata`, así que la columna
formaliza un dato preexistente.

**c) Máquina de estados.** Los webhooks llegan desordenados. La transición sólo
avanza, nunca retrocede:

```
FALLIDO     (el proveedor nunca lo aceptó; estado terminal)
PENDIENTE -> ENVIADO -> ENTREGADO -> REBOTADO(hard) -> QUEJA
```

Un evento se aplica sólo si su precedencia es mayor que la del estado actual.

El **soft bounce no modifica `estado`**: escribe `bounced_at` y
`bounce_tipo='SOFT'` y nada más, porque tras un rebote blando la entrega suele
concretarse. Sin esta regla, un `delivered` que llega tarde pisaría una queja ya
registrada, que es el dato de mayor valor.

Esta misma regla aporta **idempotencia**: Resend reintenta, y reaplicar un
evento ya aplicado no produce cambios. No hace falta tabla de eventos ni
deduplicación por `svix-id`.

### Tabla `email_suprimidos`

```sql
CREATE TABLE email_suprimidos (
  id                  TEXT PRIMARY KEY DEFAULT generate_cuid(),
  email               TEXT NOT NULL,
  motivo              TEXT NOT NULL,   -- HARD_BOUNCE | QUEJA | MANUAL
  proveedor           TEXT,
  organization_id     TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  notification_log_id TEXT REFERENCES notification_logs(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX email_suprimidos_email_idx ON email_suprimidos(lower(email));
```

**La supresión es global, no por organización.** Es consecuencia directa de
haber descartado el remitente propio por taller: las organizaciones comparten
`avisos.stapp.com.ar`, de modo que comparten reputación. Si la organización A
recibe un hard bounce y la B sigue enviando a esa misma casilla inexistente, lo
que se degrada es el subdominio de todas. `organization_id` se conserva para
auditoría —saber quién originó la supresión— pero **la consulta es por email
únicamente**.

Aplica igual a las quejas: quien marcó un correo como spam tiende a repetirlo, y
la tasa de quejas es el indicador que más rápido degrada un dominio.

**Chequeo previo al envío.** `sendCustomer()` consulta la supresión antes de
llamar a Resend. Si la dirección está suprimida: no envía, y registra
`estado='FALLIDO'` con `error_message='email suprimido: <motivo>'`. Es un lookup
indexado.

**Acceso.** RLS habilitado sin políticas, más `REVOKE` para `anon` y
`authenticated`. Es una tabla global sin `organization_id` obligatorio: expuesta
vía PostgREST filtraría direcciones de clientes de todas las organizaciones.
Precedente: `asistente_*` quedó expuesta en producción por omitir este paso.

## Webhook

`app/api/webhooks/resend/route.ts`

**Eventos suscritos:** `email.delivered`, `email.bounced`, `email.complained`.

No se suscriben `opened` ni `clicked`. Habilitar seguimiento de aperturas
inyecta un pixel de rastreo en cada correo, lo que empuja el spam score en
contra justo cuando el objetivo es preservar reputación. Además, las aperturas
no aportan a ninguno de los tres objetivos del cambio.

### Verificación de firma

El endpoint escribe en la base de datos y da de baja direcciones de correo. Sin
validación de firma, cualquiera que descubra la URL podría suprimir direcciones
arbitrarias y dejar sin notificaciones a los talleres, sin que ningún error se
manifieste. La firma es la autenticación: no va bajo `requireCronAuth`, va bajo
verificación Svix con `RESEND_WEBHOOK_SECRET` (headers `svix-id`,
`svix-timestamp`, `svix-signature`).

**Detalle de implementación:** la firma se calcula sobre el cuerpo crudo. Hay
que leer `await req.text()` y parsear después. Invocar `req.json()` primero
consume el stream y la verificación falla siempre.

### Códigos de respuesta

- Firma inválida o headers ausentes: **401**, sin ninguna escritura.
- `provider_message_id` desconocido: **200**, no 500. Devolver error haría que
  Resend reintente indefinidamente sobre correo que nunca registramos (todo lo
  anterior a esta migración). Se registra en log y se continúa.
- Evento procesado: **200**.

## Manejo de errores

| Situación | Conducta | Razón |
|---|---|---|
| Resend responde 429 o 5xx | Registrar `FALLIDO`, continuar. Sin reintentos. | No existe cola. La fila queda en `notification_logs` con el error y es reenviable manualmente. Un retry inline dentro de un fire-and-forget alarga el request sin garantizar nada. |
| Resend responde 401 (key inválida) | Lanzar error. **No** caer a EnvialoSimple. | Un fallback en runtime rompe dos cosas a la vez: envía correo de taller por el dominio que se quería aislar, y oculta la configuración rota. Configuración ausente es una decisión; envío fallido es una falla. |
| `RESEND_API_KEY` no definida | Caer a EnvialoSimple. | Es el kill switch. |
| Falla el lookup de supresión | **Enviar igual** (fail open), con el error registrado. | Fallar cerrado deja mudas a todas las organizaciones ante un problema transitorio de base. El costo de un envío de más a una casilla muerta es acotado; el de silenciar a todos, no. |
| Falla el envío al cliente | No bloquea el cambio de estado de la orden. | Conducta preexistente (fire-and-forget). Se preserva. |

## Testing

Vitest, siguiendo el patrón de `__tests__/api/` (`vi.mock("@/lib/email")` más los
helpers `createChainMock`). Modo TDD estricto: el test primero.

**Ruteo y kill switch**

1. `sendCustomer` alcanza Resend y `sendPlatform` alcanza EnvialoSimple —
   aserción sobre el destino del `fetch`. Es el guard contra el canal equivocado.
2. Sin `RESEND_API_KEY`, `sendCustomer` cae a EnvialoSimple.
3. Resend responde 401: lanza error y **no** se produce un segundo `fetch` a
   EnvialoSimple.

**Supresión**

4. Dirección suprimida: cero llamadas a `fetch`, fila `FALLIDO` con el motivo.
5. El lookup de supresión falla: el envío ocurre igual.

**Webhook**

6. Firma inválida o headers `svix-*` ausentes: 401 y ninguna escritura.
7. `delivered` produce `ENTREGADO`; `bounced` hard produce `REBOTADO` más fila en
   `email_suprimidos`; `complained` produce `QUEJA` más supresión.
8. Soft bounce: `estado` no cambia, se escribe `bounce_tipo='SOFT'`.
9. `delivered` recibido después de `complained`: el estado permanece en `QUEJA`.
   Es el caso que prueba la precedencia y el que refleja el desorden real de los
   webhooks.
10. Evento repetido: idempotente, sin cambios.
11. `provider_message_id` desconocido: 200, no 500.

### Límites de la suite

La suite verde no cubre tres cosas. Precedente: en el incidente de React #31 la
suite estaba completamente verde con todos los PDFs rotos en producción, porque
el defecto vivía en el bundle.

- **DNS.** Ningún test verifica SPF, DKIM ni DMARC. Con el subdominio mal
  configurado, todo pasa verde y el correo va a spam.
- **Payload real.** El mock siempre responde ok. Que Resend acepte el cuerpo que
  se arma sólo se comprueba enviando.
- **La migración.** El mock no inspecciona el esquema. Si el `ALTER TYPE` queda
  agrupado con el resto, el enum no se crea y los tests pasan igual.

### Verificación manual obligatoria

Resend ofrece direcciones de simulación que no afectan la reputación del
dominio y aceptan sufijos `+etiqueta`, de modo que la terna puede repetirse sin
colisionar filas:

| Destino | Verifica |
|---|---|
| `delivered@resend.dev` | camino feliz, estado `ENTREGADO` |
| `bounced@resend.dev` | SMTP 550 5.1.1, estado `REBOTADO` más supresión |
| `complained@resend.dev` | marcado como spam, estado `QUEJA` más supresión |

Con esto el webhook queda ejercitado punta a punta contra el proveedor real.
Después, un envío a una casilla propia para revisar el remitente, el render y
que no caiga en spam.

## Pasos de operación (fuera del código)

1. Verificar el dominio `avisos.stapp.com.ar` en Resend.
2. Cargar los registros DNS: SPF (TXT), DKIM (CNAMEs), DMARC iniciando en
   `p=none`.
3. Endurecer la política DMARC una vez que el flujo esté limpio.
4. Configurar el endpoint de webhook en Resend y guardar
   `RESEND_WEBHOOK_SECRET`.
5. Aplicar la migración 321 con `scripts/db-run.mjs` (dry-run primero; el
   `ALTER TYPE` en query separada).
6. Cargar `RESEND_API_KEY` en Vercel — este es el acto de activación.

Sin los pasos 1 a 3 no hay aislamiento de reputación, con independencia de que
el código funcione.

## Orden de entrega

Cuatro PRs encadenados, cada uno mergeable por separado:

| PR | Contenido | Riesgo |
|---|---|---|
| **1** | Abstracción `EmailProvider`, EnvialoSimple movido, router. Sin Resend. | Nulo: conducta idéntica. Es la costura. |
| **2** | Migración 321, provider Resend, kill switch. Desplegado sin la key. | Nulo en producción: sin key todo sigue por EnvialoSimple. |
| **3** | Webhook, supresión, chequeo previo en `sendCustomer`. | Punto de activación: verificar DNS, correr la terna `@resend.dev`, cargar la key. |
| **4** | Estado de entrega visible en el historial de notificaciones de la orden. | Opcional. Es lo que convierte el seguimiento en algo útil para el taller. |

El corte relevante está entre el 2 y el 3: **el código llega a producción
apagado**, y el interruptor es cargar `RESEND_API_KEY` en Vercel. Ante cualquier
problema, se borra la variable y el sistema vuelve a EnvialoSimple sin necesidad
de desplegar.

## Riesgos conocidos

- **El volumen real no es medible hoy.** `notification_logs` registra los
  intentos, pero nunca se consultó con este fin y no hay panel que lo agregue.
  Si el volumen resultara inferior a 9.000/mes y a 300/día, el plan gratuito de
  Brevo lo cubriría y Resend costaría USD 20 de más. Mitigación: el PR 4 expone
  el dato; la decisión de proveedor es revisable con un cambio acotado gracias a
  la abstracción del PR 1.
- **Resend contabiliza cada destinatario por separado** (To, CC y BCC) y también
  el correo entrante contra la misma cuota. El canal de cliente envía siempre a
  un único destinatario, así que hoy no aplica, pero condiciona cualquier uso
  futuro con copias.
- **Deuda pendiente:** cinco copias de la llamada a EnvialoSimple siguen
  duplicadas (4 crons más el webhook de MercadoPago). No se tocan acá porque
  envían correo de plataforma y refactorizarlas agrega riesgo sin beneficio para
  este cambio. Queda como follow-up independiente.
- **La supresión global es una decisión deliberada** que puede resultar
  contraintuitiva: un cliente que se queja del taller A deja de recibir correo
  del taller B. Es correcto mientras el subdominio sea compartido. Si en el
  futuro se adopta remitente propio por organización, esta decisión debe
  revisarse junto con ella.
