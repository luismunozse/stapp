# Spec: cobro recurrente con PreApproval de MercadoPago

**Fecha:** 2026-08-22
**Estado:** Aprobado para planificación
**Alcance:** Tres PRs. Alta y activación del débito automático, ventana de gracia frente al cron de vencimientos, y campaña de migración de los pagadores actuales.

---

## 1. Contexto

El cobro en pesos no es recurrente. El checkout crea una **Preference** de MercadoPago, que es un pago único: el taller tiene que volver a pagar a mano todos los meses, sin que nada se lo recuerde.

El diagnóstico del 2026-07-26 (`stapp-diagnostico-billing-conversion`) midió la consecuencia: de 25 organizaciones que pagaron alguna vez, 12 se cayeron, y **9 de esas 12 pagaron una sola vez**. No es un problema de adquisición: es la pared del segundo mes.

### 1.1 Lo que ya está construido

Casi toda la mitad receptora del flujo existe y está probada en producción:

| Pieza | Dónde | Estado |
|---|---|---|
| `createSubscription()` — crea el PreApproval | `lib/mercadopago.ts:133` | Escrita, **nadie la llama** |
| `cancelPreApproval()` | `lib/mercadopago.ts` | Cableada en `app/api/subscriptions/cancel/route.ts:34` |
| `getPreApproval()` | `lib/mercadopago.ts` | Escrita |
| `mercadopago_preapproval_id` | `subscriptions`, migración `006_saas_schema.sql:66` + índice `:87` | Existe |
| `handlePreApprovalNotification` | `webhook/route.ts:581` | Mapea `authorized/paused/cancelled` → `ACTIVE/PAST_DUE/CANCELED` |
| `handleAuthorizedPaymentNotification` | `webhook/route.ts:654` | **Con un bug de producción ya corregido y documentado** |
| Ruteo de eventos | `webhook/route.ts:101-123` | Cubre `payment`, `subscription_preapproval` y `subscription_authorized_payment`, en formato v1 y v2 |

El comentario de `handleAuthorizedPaymentNotification` documenta el bug que ya se pagó: el `data.id` de ese evento no es un payment id de `/v1/payments` sino un `authorized_payment`; mandarlo al handler equivocado daba 404 → throw → webhook 500 → MP reintentaba tres veces → **la suscripción nunca se renovaba sola**. El flujo correcto ya está implementado: `GET /authorized_payments/{id}` → `GET /preapproval/{preapproval_id}` para recuperar el `external_reference` → delegar en `handlePaymentNotification` con el payment id real.

Lo que falta es únicamente el lado emisor: `app/api/mercadopago/preference/route.ts` llama a `createPaymentPreference` (pago único) y nadie llama nunca a `createSubscription`.

### 1.2 Datos medidos, no supuestos

Distribución real de los 30 pagos cobrados por MercadoPago en los últimos 6 meses (`scripts/mp-medios-de-pago.mjs`, consultando la API de MercadoPago pago por pago):

| Medio | Pagos | % | ¿Admite débito automático? |
|---|---|---|---|
| `account_money` | 17 | 57% | Sí |
| `prepaid_card` | 7 | 23% | **NO.** Verificado el 2026-08-23 |
| `debit_card` | 4 | 13% | Sí |
| `credit_card` | 2 | 7% | Sí |

**Cero pagos en efectivo.** Nadie usa Rapipago ni Pago Fácil, así que forzar un medio compatible con débito automático no deja a nadie afuera por ese lado.

La documentación de suscripciones de MercadoPago lista **tarjeta de crédito, tarjeta de débito y dinero disponible en Mercado Pago**. La tarjeta prepaga no aparece nombrada.

**Verificado el 2026-08-23**: se creó un PreApproval real (`scripts/mp-probar-adhesion.mjs`) y se abrió su pantalla de adhesión. **La tarjeta prepaga NO figura entre los medios ofrecidos** — y según el titular de la cuenta, tampoco aparece para ningún otro servicio con débito automático. Deja de ser un riesgo abierto y pasa a ser una restricción conocida: esos 7 talleres no pueden adherir.

Eso no invalida nada de este diseño; lo confirma. Es exactamente el motivo por el que los dos modelos conviven (§2, decisión 1): el pago único es su camino y sigue intacto. Lo único que cambia es la campaña (§5), que tiene que decir de entrada qué medios sirven para que nadie choque contra una pared sin explicación.

**El 80% paga con saldo, no con crédito.** `account_money` y `prepaid_card` dependen de que haya fondos en el momento exacto del cobro. Una tarjeta de crédito autoriza casi siempre; una billetera vacía, no. Con débito automático eso deja de ser "el cliente se olvidó" y pasa a ser "el cobro rebotó", que necesita reintentos y aviso. MercadoPago reintenta por su cuenta: es el estado `recycling` que el handler ya contempla.

### 1.3 El choque con el cron de vencimientos

`app/api/cron/subscription-sweep/route.ts` barre a diario las suscripciones `ACTIVE` con `current_period_end` vencido y, para MercadoPago, las marca `PAST_DUE` — que bloquea al taller en `/suscripcion-requerida`. El comentario del archivo dice *"esperamos resolución webhook"*.

Eso funciona mientras el pago sea manual, donde la fecha vencida **sí** significa que el taller no pagó. Con débito automático deja de significar eso: MercadoPago puede estar reintentando un cobro que va a prosperar. Con el 80% de los pagos dependiendo de saldo, el rebote no va a ser la excepción.

**Sin cambiar esto, la primera consecuencia visible de activar el débito automático sería cortarle el sistema a talleres que sí están por pagar.**

---

## 2. Decisiones tomadas

1. **Los dos modelos conviven.** El taller elige débito automático o pago único. Cubre al 23% de prepagas si MercadoPago las rechaza, y a quien no quiera dar una autorización permanente.
2. **PreApproval sin plan asociado.** Es lo que `createSubscription()` ya hace. Crear `preapproval_plan` en MercadoPago agregaría objetos a mantener sincronizados con la tabla `plans` sin comprar nada mientras haya dos tiers.
3. **A los 13 pagadores actuales se los invita activamente** a migrar, por mail y WhatsApp. Son el origen del problema: si no se los mueve, el débito automático solo protege a los que vengan.

---

## 3. PR 1 — Alta y activación

### 3.1 Ruta nueva

`POST /api/mercadopago/preapproval`, hermana de `/api/mercadopago/preference`. Mismo `requireAuth`, mismo schema de entrada (`billingPeriod`, `planSlug`), misma validación de organización. Llama a `createSubscription()` y devuelve el `init_point` del PreApproval.

Se elige una ruta nueva en vez de un flag en `/preference` porque son dos objetos distintos de MercadoPago con dos respuestas distintas: mezclarlas obliga a que el caller adivine qué recibió.

### 3.2 UI del checkout

`components/billing/upgrade-modal.tsx:98` hoy pega siempre a `/api/mercadopago/preference`. Se agrega un selector de dos opciones:

- **Pago único** (por defecto) → `/api/mercadopago/preference`, el flujo actual sin cambios
- **Débito automático** → `/api/mercadopago/preapproval`

**El débito automático es una elección explícita, no el default.** Es una autorización permanente sobre el medio de pago de otra persona: que venga preseleccionada empuja a alguien a darla sin decidirlo. Que convenga al negocio no lo vuelve el default correcto.

El copy tiene que decir qué implica cada uno: el débito automático se cobra solo todos los meses hasta que lo canceles; el pago único vence y hay que volver a pagar a mano.

### 3.3 Completar la activación

`handlePreApprovalNotification` (`webhook/route.ts:581`) hoy escribe **solo** `status` y `mercadopago_preapproval_id`. Le falta:

- `plan_id` — sale del `plan_slug` / `plan_id` del `external_reference`, que `createSubscription()` ya carga.
- `billing_period`
- `payment_provider: "MERCADOPAGO"`
- `current_period_start` / `current_period_end` — el primer cobro llega por `subscription_authorized_payment` y ahí se fija el período. En la autorización el período queda en NULL hasta que llegue ese cobro, y por eso el guard de §3.6 entra en ESTE PR y no en el siguiente.

Sin `plan_id`, una organización que adhiere queda `ACTIVE` sobre el plan que tuviera antes: adhiere al Profesional y sigue con los límites del Free.

### 3.6 El guard del período en NULL (adelantado desde el PR 2)

Una suscripción `ACTIVE` con `current_period_end` en NULL **no la barre nadie**: el cron filtra `current_period_end IS NOT NULL`. Una organización que adhiere y cuyo primer cobro nunca llega se queda con el plan pago para siempre sin haber pagado nunca.

Es la misma familia del bug de la migración 304: una regla que se aplica por fecha, sobre una fila donde la fecha no existe.

El sweep suma una segunda pasada: suscripción `ACTIVE`, sobre un plan de precio mayor a cero, con `current_period_end` en NULL, creada hace más de 12 días y **sin un solo pago `SUCCEEDED`** → `PAST_DUE`.

Los 12 días son los mismos de §4.1 y por el mismo motivo: una adhesión recién hecha todavía puede estar esperando su primer cobro.

**Esto puede estar pasando hoy, antes de PreApproval.** Nada impide que una suscripción quede `ACTIVE` sobre un plan pago con el período en NULL por otra vía. Antes de implementar, hay que correr la consulta de §8.6: si devuelve filas, el guard deja de ser prevención y pasa a ser una corrección urgente que sale sola, sin esperar a PreApproval.

**Tests:**

- Sub ACTIVE, plan pago, período NULL, creada hace 20 días, cero pagos → `PAST_DUE`.
- La misma creada hace 3 días → no se toca (puede estar esperando el primer cobro).
- Sub ACTIVE, plan pago, período NULL, **con** un pago exitoso → no se toca.
- Sub ACTIVE sobre plan **gratis** con período NULL → no se toca. Son la mayoría: Free y trials.

### 3.4 Los cobros mensuales no se tocan

Ya funcionan: `subscription_authorized_payment` → `handleAuthorizedPaymentNotification` → `handlePaymentNotification`, que reusa la idempotencia (con el UNIQUE de la migración 305), registra el pago en `subscription_payments` y extiende el período. Esa ruta ya sobrevivió a un bug de producción; no se reescribe.

### 3.5 Tests

- La ruta nueva exige auth y valida la organización.
- `handlePreApprovalNotification` escribe `plan_id`, `billing_period` y `payment_provider`, no solo el status.
- El mapeo de estados: `authorized → ACTIVE`, `paused → PAST_DUE`, `cancelled → CANCELED`, y un estado desconocido no rompe.
- Una organización que adhiere queda con el plan del `external_reference`, no con el que tenía antes.

---

## 4. PR 2 — Ventana de gracia y UI honesta

### 4.1 La gracia

`subscription-sweep` no marca `PAST_DUE` cuando la suscripción tiene `mercadopago_preapproval_id` y su `current_period_end` venció hace **menos de 12 días**.

El número sale de la política de MercadoPago, no de una estimación: cuando un cobro se rechaza, la cuota entra en estado `recycling` y **se reintenta durante 10 días, con un máximo de 4 intentos**. Si el cuarto falla, la cuota queda procesada con pago rechazado. Los 12 días son esos 10 más margen para que llegue el webhook.

**La cancelación de MercadoPago NO sirve como señal de bloqueo.** MercadoPago recién cancela la suscripción **después de 3 cuotas con pago rechazado** — alrededor de tres meses. Esperar esa señal significaría regalar tres meses de servicio a alguien cuyo cobro rebota desde el primero.

Por eso la fecha sigue siendo nuestra señal, y lo único que cambia es cuánto hay que esperarla: 12 días en vez de cero. Vencido ese plazo sin un cobro nuevo registrado, se marca `PAST_DUE` como hoy — MercadoPago agotó sus reintentos y el mes no se cobró.

`handlePreApprovalNotification` sigue siendo la vía rápida: si el taller cancela desde MercadoPago, el estado llega antes que la fecha y no hay que esperar nada.

La regla se implementa como una función pura con tests, no como una condición suelta dentro del cron.

### 4.2 La UI que hoy miente

`components/billing/current-plan.tsx:123` muestra **"Próxima facturación: {fecha}"** a todo el mundo. Para quien paga manual eso es falso: no se le va a cobrar nada, la suscripción vence y se bloquea.

Con este cambio:

- Con `mercadopago_preapproval_id` → *"Próxima facturación: {fecha}"*. Ahora es cierto.
- Sin él → *"Vence el {fecha}. Renovás vos."*, con el botón de pago a la vista.

### 4.3 Tests

- Una sub con `preapproval_id` vencida hace 3 días no se marca `PAST_DUE` (MercadoPago sigue reintentando).
- La misma vencida hace 15 días **sí** se marca: los 10 días de reintentos ya pasaron.
- Una sub sin `preapproval_id` vencida hace 1 día se marca, como hoy.
- Una sub `MANUAL` sigue bajando a Free, sin cambios.
- El copy de `current-plan` cambia según haya o no `preapproval_id`.

---

## 5. PR 3 — Migración de los pagadores actuales

### 5.1 El link de adhesión

Endpoint que, para una organización dada, genera el `init_point` de su PreApproval y lo devuelve como link de un clic. Reusa `createSubscription()`.

### 5.2 El envío

Mail y WhatsApp. La infraestructura de WhatsApp ya existe y hoy se usa para que los talleres le recuerden a **sus** clientes que paguen (`stapp-recordatorios-cobro-whatsapp`). Es la misma infraestructura, aplicada al cobro propio.

El mensaje explica qué cambia: se cobra solo, se cancela cuando quieras, y no hay que acordarse todos los meses.

### 5.3 Control de la campaña

- Se envía **una sola vez** por organización; queda registrado para no repetir.
- No se le escribe a quien ya tiene `mercadopago_preapproval_id`.
- No se le escribe a quien está en Free o en trial: el mensaje es para quien ya paga.

### 5.4 Tests

- Una org con `preapproval_id` queda excluida.
- Una org en Free o trial queda excluida.
- La misma org no recibe el mensaje dos veces.

---

## 6. No-objetivos

- **Aumentos de precio sobre suscripciones vigentes.** Ver §7; entra como PR propio.
- **Migrar Creem o Rebill.** Creem ya tiene recurrencia real; Rebill está cableado sin UI.
- **Dunning completo** (secuencia de avisos previos al vencimiento, recuperación de caídos). Es el problema hermano y merece su propio spec.
- **Métrica de conversión trial→pago en el panel superadmin.**
- **Cobro recurrente para planes anuales.** `createSubscription()` ya soporta `frequency: 12`, pero la campaña y las pruebas arrancan sobre el mensual, que es donde está el churn.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| ~~**MercadoPago no acepta tarjetas prepagas**~~ CONFIRMADO el 2026-08-23 | No es hipótesis: la prepaga no figura en la pantalla de adhesión. El pago único queda como su camino. La campaña (§5) debe aclarar los medios aceptados en el propio mensaje. |
| **`back_url` con `localhost` es rechazado por la API de PreApproval** | Verificado el 2026-08-23: devuelve `400 Invalid value for back_url`. `NEXTAUTH_URL` vale `http://localhost:3000` en desarrollo, así que el flujo NO se puede probar en local sin apuntarla a una URL pública. En producción Vercel la define con el dominio real. Conviene que la ruta devuelva un error explícito en vez de dejar pasar el 400 opaco de MercadoPago. |
| **Inflación: una PreApproval cobra el mismo monto para siempre** | Actualizar el importe por API cuando cambie el precio del plan. **Hay que verificar si MercadoPago exige re-autorización del pagador al subir el monto**: si la exige, el aumento se vuelve una campaña, no un update. Fuera del primer slice. |
| **El 80% paga desde saldo: los rebotes van a ser frecuentes** | La ventana de gracia de 12 días (§4.1) evita el bloqueo durante los 10 días de reintentos de MercadoPago. El aviso al taller de que su cobro rebotó es parte del dunning, que es otro spec — y con esta política se vuelve más urgente: MercadoPago reintenta 4 veces en silencio y el taller no se entera de que su billetera está vacía. |
| **Un taller adhiere y además paga a mano el mismo mes** | El período se apila (`webhook/route.ts:441-447`), que es el comportamiento correcto: pagó dos meses. El UNIQUE de la 305 evita que un mismo pago se cuente dos veces. |
| **La campaña llega a quien no corresponde** | Los tres filtros de §5.3, cubiertos por tests. |
| **Un taller con cobros rechazados sigue con la suscripción viva en MercadoPago hasta 3 cuotas** | No se espera esa cancelación para bloquear: la ventana de 12 días la resuelve antes. Se documenta para que nadie "arregle" el cron confiando en el estado que reporta MercadoPago. |
| **Adhiere y el primer cobro nunca llega** | Resuelto en el PR 1 (§3.6), adelantado desde el PR 2 por pedido explícito: el plan pago sin ningún pago detrás es plata, no una molestia. |

---

## 8. Verificación

Ninguna de estas piezas se puede probar de verdad sin MercadoPago del otro lado. Antes de exponer el débito automático a los talleres:

### 8.6 Antes de escribir una línea

Correr esto: dice si el hueco del período en NULL ya está ocupado hoy.

```sql
SELECT o.nombre, p.nombre AS plan, p.precio_mensual, s.created_at,
       COUNT(sp.id) FILTER (WHERE sp.status = 'SUCCEEDED') AS pagos
FROM subscriptions s
JOIN organizations o ON o.id = s.organization_id
JOIN plans p         ON p.id = s.plan_id
LEFT JOIN subscription_payments sp ON sp.organization_id = s.organization_id
WHERE s.status = 'ACTIVE'
  AND p.precio_mensual > 0
  AND s.current_period_end IS NULL
GROUP BY o.nombre, p.nombre, p.precio_mensual, s.created_at
ORDER BY s.created_at;
```

Cada fila es una organización con plan pago activo, sin fecha de vencimiento y —si `pagos` da cero— sin haber pagado nunca. Si devuelve filas, el guard de §3.6 sale como corrección propia, antes que PreApproval.

### 8.7 Con MercadoPago del otro lado

1. Adherir con una cuenta de prueba y confirmar que la suscripción queda `ACTIVE` **con el plan correcto**.
2. Confirmar que el primer cobro llega como `subscription_authorized_payment` y extiende el período.
3. Cancelar desde la app y verificar que MercadoPago deja de cobrar.
4. Confirmar si una tarjeta prepaga puede adherir (riesgo del 23%).
5. Recién entonces, la campaña.
