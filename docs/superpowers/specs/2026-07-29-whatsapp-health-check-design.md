# WhatsApp health check + recordatorios en hora local

Fecha: 2026-07-29

## Problema

Dos fallas reportadas, con causas independientes.

### 1. Los mensajes automáticos de WhatsApp no se envían

El servidor Evolution compartido estuvo caído desde el 2026-07-28 22:11 UTC. Evidencia en `notification_logs`, filtrando sólo los intentos que llegan a la API (`ENVIADO`/`FALLIDO`):

| org | último ENVIADO | primer 500 | envíos OK posteriores |
|---|---|---|---|
| celulares-sofia | 2026-07-28 19:17 | 2026-07-28 22:11 | 0 |
| romemaq | 2026-07-28 21:45 | 2026-07-29 14:21 | 0 |
| cao-tech | 2026-07-28 20:20 | 2026-07-29 00:25 | 0 |
| mcell | — | 2026-07-29 17:42 | 0 |
| rcm-comunicaciones | — | 2026-07-25 23:13 | 0 |

21 intentos, 21 `Internal Server Error`, 0 éxitos en ~23 horas, en 5 organizaciones con instancias distintas. No es formato de teléfono: el número `8636…84` se envió OK el 07-28 19:17 y falló el mismo día a las 23:04.

#### Causa y resolución

El servidor estaba **sano**: disco al 18%, 2.4 GB de RAM libres, los cuatro contenedores con seis semanas de uptime y cero reinicios, y `fetchInstances` respondiendo HTTP 200. La infraestructura nunca falló.

Lo que falló fueron las sesiones de WhatsApp. `fetchInstances` mostró que las 7 instancias en `open` tenían su `updatedAt` congelado entre las 21:53 y las 22:03 del 28 — ocho minutos antes del primer 500 — y no se habían actualizado en 25 horas. Sesiones zombi: `connectionStatus: open` sobre un socket muerto. Los logs escupían `Bad MAC` de libsignal (desincronización de claves Signal) a razón de miles por hora.

`CONFIG_SESSION_PHONE_VERSION` estaba pineado en `2.3000.1035194821` contra un Baileys vigente en `2.3000.1043857760`. Se lo actualizó y se recreó el contenedor. Resultado: todas las instancias volvieron a hacer handshake y 6 quedaron operativas. Se verificó con `POST /chat/whatsappNumbers`, que devolvió `{"exists":true}` — ida y vuelta real contra WhatsApp, sin enviar mensajes.

No quedó probado que la versión obsoleta *causara* el corte; la simultaneidad de las 7 caídas apunta a un cutoff del lado de WhatsApp, y actualizarla fue lo que permitió recuperarse. El `Bad MAC` resultó ser ruido: siguió apareciendo con el mismo volumen después de que las sesiones ya funcionaban.

Las 12 instancias restantes quedaron en loop de QR (5 con `disconnectionReasonCode: 401`, o sea logout explícito del teléfono) y requieren que cada taller reescanee.

#### Por qué nadie se enteró en 23 horas

Tres factores:

1. `evolution_connection_state` sólo se refresca cuando un admin abre la pantalla de configuración (`components/configuracion/whatsapp-setup.tsx` pollea con un `setInterval` dentro de un `useEffect`). El de `celulares-sofia` decía `open` con `updated_at` del 2026-07-06.
2. El fallback de `lib/notifications/send-direct.ts` escribe `estado: "PENDIENTE"` con un link `wa.me` y no avisa a nadie. ~700 en 14 días.
3. No hay health check ni alerta.

### 2. Los recordatorios de retiro llegaban 04:00 a un taller de UTC-6

`vercel.json` agendaba `/api/cron/recordatorios` como `0 10 * * *`. Los cron de Vercel corren siempre en UTC, y el handler recorría las 165 orgs en la misma pasada. `app/api/cron/recordatorios/route.ts` leía `org.zona_horaria` sólo para formatear fechas dentro del texto del mensaje, nunca para decidir cuándo enviar.

10:00 UTC en UTC-6 (Costa Rica, Guatemala, Nicaragua) son las 04:00. En Argentina caía 07:00, y por eso nadie lo había reportado en 155 talleres.

Confirmado en `notification_logs`: 100% de los `RECORDATORIO_RETIRO` de los últimos 30 días se crearon a las 10:00 UTC y en ningún otro horario.

## Decisiones

- **Hora de envío**: 10:00 hora local de cada organización, incluidas las argentinas (que se mueven de 07:00 a 10:00). Decisión del dueño del producto.
- **Destinatarios de las alertas**: taller y superadmin, según la falla. La sesión caída la resuelve el taller reescaneando el QR; el servidor caído lo resuelve la plataforma. Son dos dueños distintos.
- **Sin auto-reconexión**: una instancia deslogueada necesita QR nuevo, no se puede automatizar, y reintentar contra un servidor caído sólo agrega ruido.

## Diseño

### Recordatorios en hora local

`/api/cron/recordatorios` pasa a correr cada hora (`0 * * * *`) y procesa sólo las orgs donde ya son las `HORA_RECORDATORIOS_LOCAL` (10) en su `zona_horaria`, usando `getZonedParts` de `lib/timezone.ts` (DST-safe, ya existía).

Dos correcciones que aparecieron al testear:

- La ventana anti-duplicado usaba `new Date().setHours(0,0,0,0)`, o sea la zona del **proceso** (UTC en Vercel, UTC-3 en local). Pasa a `dayRangeUtc(todayInTimeZone(tz), tz)`.
- Una `zona_horaria` corrupta hace que `Intl` tire `RangeError`; con el `try/catch` a nivel de handler, una sola org rota devolvía 500 y cancelaba los recordatorios de las 165. Ahora `resolverZonaHoraria()` cae a `DEFAULT_TIMEZONE` y loguea.

`?force=1` saltea el filtro horario. Sin eso, el botón de corrida manual del superadmin quedaría no-op 23 de cada 24 horas.

### Health check

Cron nuevo `/api/cron/whatsapp-health`, cada hora. Lógica en `lib/whatsapp/health.ts` (la ruta es un wrapper delgado, así se testea sin HTTP). `ahora` se inyecta para que los tests sean deterministas.

**Paso 1 — probe de plataforma y estados, en una llamada.** `fetchInstances` (`GET /instance/fetchInstances`) cumple doble propósito: si falla, el servidor está caído o la api key ya no vale; si responde, trae el estado de todas las instancias sin necesidad de N llamadas a `connectionState`. Shape verificado contra Evolution v2.1.1 durante el incidente: array plano con `name`, `connectionStatus`, `disconnectionReasonCode`, `updatedAt`.

Si falla: email `[ALERTA]` al superadmin y **corte inmediato, sin escribir estado de instancias**. Si el cron marcara todo desconectado durante un corte global, perdería el último estado bueno conocido y notificaría a 42 talleres un problema que ninguno puede resolver.

Throttle de 6 horas mientras siga caído, para no mandar 24 mails por día. Requiere persistir el estado anterior: de ahí la tabla `platform_health_state`.

**Paso 2 — cruzar lo reportado con lo que realmente pasó.** Para cada fila con `evolution_instance_name`, se busca su estado en la respuesta y se persiste (+ `is_verified` en la tabla central). Si el servidor no lista la instancia, se preserva el estado guardado y se cuenta como `indeterminadas`: escribir `unknown` la marcaría incapaz de enviar (ver `resolve-sender.ts`) por una pregunta que no se pudo responder.

Además se detectan **sesiones zombi**, que es la lección más caras del incidente: Evolution reportaba `connectionStatus: open` para 7 instancias cuyo socket estaba muerto, y la app siguió intentando enviar 23 horas. **`connectionStatus` no prueba que se pueda enviar.** La única fuente que no puede mentir son nuestros propios intentos: si en las últimas 3 horas una org acumuló 3 o más envíos por WhatsApp y *todos* fallaron, se la trata como desconectada aunque el servidor jure lo contrario.

Esa detección se limita a la instancia central: `notification_logs` no guarda `sucursal_id`, así que un fallo no se puede atribuir a una sucursal puntual.

**Paso 3 — alerta al taller en la transición.** Sólo cuando el estado pasa de `open` a inutilizable: `user_notifications` para los ADMIN de esa org, `type: "WHATSAPP_DESCONECTADO"`, `action_url: /configuracion`. Sólo en la transición: un taller desconectado una semana juntaría 168 notificaciones idénticas. Con `disconnectionReasonCode: 401` el mensaje dice que se cerró la sesión; en el resto de los casos, que dejó de enviar.

Cuando la plataforma vuelve, un mail `[OK]` cierra el incidente.

### Por qué no un probe activo del socket

La prueba irrefutable de que una sesión sirve es hacerla trabajar: `POST /chat/whatsappNumbers` consulta los servidores de WhatsApp a través del socket sin enviar ningún mensaje. Se usó durante el incidente y fue lo que confirmó la recuperación.

No se adoptó para el cron: serían ~18 consultas por hora contra los servidores de WhatsApp de forma indefinida, sobre un cliente no oficial. El riesgo de que eso se lea como comportamiento automatizado no compensa, cuando `notification_logs` da la misma señal gratis y sin exposición. Queda como herramienta de diagnóstico manual.

### Esquema

`supabase/migrations/281_platform_health_state.sql` — una fila por servicio monitoreado: `service` (PK), `state` (`up`/`down`), `last_error`, `checked_at`, `changed_at`, `last_alert_at`. RLS activo sin policies: es infraestructura de plataforma, se escribe y lee sólo con `service_role` desde el cron.

Se usó el número 281 porque ya hay colisión en 280 entre ramas (`280_dunning_email_templates.sql` y `280_servicios_orden_atomico.sql`).

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/281_platform_health_state.sql` | nuevo |
| `lib/whatsapp/health.ts` | nuevo — lógica del health check |
| `lib/whatsapp/__tests__/health.test.ts` | nuevo — 12 tests |
| `app/api/cron/whatsapp-health/route.ts` | nuevo — wrapper |
| `lib/whatsapp/providers/evolution.ts` | + `fetchInstances` (probe + estados en una llamada) |
| `app/api/cron/recordatorios/route.ts` | filtro por hora local, dedup por día local, `resolverZonaHoraria`, `?force=1` |
| `lib/cron-config.ts` | + `HORA_RECORDATORIOS_LOCAL`, + job `whatsapp-health` |
| `vercel.json` | recordatorios `0 10 * * *` → `0 * * * *`; + `whatsapp-health` horario |
| `app/api/superadmin/run-cron/route.ts` | + `force=1`, + handler de `whatsapp-health` |
| `components/notifications/notification-panel.tsx` | ícono para `WHATSAPP_DESCONECTADO` |
| `__tests__/api/cron-recordatorios.test.ts` | 4 → 13 tests, con `vi.setSystemTime` |

## Deuda de infraestructura detectada

El `docker-compose.yml` del server no configura `logging`, así que los tres contenedores usan el driver `json-file` **sin rotación**. En 40 GB se llena solo con el tiempo, y cuando pase, Postgres deja de escribir y el síntoma va a ser idéntico al de este incidente: 500 en todo, servidor aparentemente sano. Corresponde agregar `max-size` / `max-file` por servicio. No se tocó en esta pasada.

## Fuera de alcance

- **Reparar el servidor Evolution desde la app.** Este diseño detecta y avisa, no repara. `EVOLUTION_BASE_URL` y `EVOLUTION_API_KEY` sólo viven en las env vars de Vercel.
- **Re-pareo automático de instancias.** Un `disconnectionReasonCode: 401` significa que el teléfono cerró la sesión: no hay forma de automatizar el reescaneo del QR.
- **Visibilidad del estado `PENDIENTE`.** El fallback silencioso de `send-direct.ts` sigue existiendo. El health check ataca la causa (estado podrido) pero no expone el histórico de mensajes que nunca salieron.
- **Auto-reconexión de instancias.**
- **`catalogo-pii-purge` está en `CRON_JOBS` pero no en `CRON_HANDLERS`**: su botón de corrida manual devuelve 400. Preexistente, no se tocó.

## Requisitos de entorno

`SUPERADMIN_EMAIL` tiene que estar seteada o las alertas de plataforma no salen (se loguea el error y el health check sigue). `SUPERADMIN_EMAILS` (plural, para auth) ya existe y es una variable distinta.
