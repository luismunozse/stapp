# Captación de leads en el chatbot de la landing

**Fecha:** 2026-06-27
**Branch:** `feat/chatbot-lead-capture`

## Problema

El chatbot de la landing ya tiene un sistema de captación de leads (extracción
con IA, deduplicación, scoring, panel de superadmin), pero **no convierte**:
sobre 40 conversaciones reales sólo se capturó 1 lead, y ese fue una prueba
interna (sin nombre ni teléfono).

Causa: la captación depende de que la IA "extraiga" el contacto del texto libre
de la charla. Los visitantes conversan pero **no dejan sus datos** de forma
espontánea, y la extracción pasiva rara vez los obtiene.

## Objetivo

Que el bot sea **puerta de entrada** (responde dudas) **y** **canal de
captación**: en el momento justo, ofrecer un paso explícito de baja fricción
para que el visitante deje su contacto y el equipo lo contacte después.

No-goals (YAGNI): secuencias de follow-up automáticas, dashboard de analítica,
integración con Slack/SMS, aviso por WhatsApp al equipo (se revisa desde el
panel de superadmin, que ya existe).

## Diseño

### 1. Mini-form en el chat (frontend)

Componente nuevo `LeadCaptureForm` dentro de `components/chatbot/`, usado por
`chatbot-panel.tsx`.

- **Campos:** Nombre + WhatsApp. Botón *Enviar*. Validación: nombre no vacío,
  WhatsApp con al menos 8 dígitos (se limpia a dígitos antes de enviar).
- **Botón fijo:** un CTA siempre visible en el panel (debajo del input):
  *"📞 Quiero que me contacten"* → abre/expande el form inline.
- **Auto-aparición por interés:** la respuesta del API del chatbot ya incluye
  `intencion` y `leadScore`. Cuando hay señal de interés
  (`leadScore >= 60` o `intencion ∈ {solicitar_demo, preguntar_precio,
  lead_calificado}`), el panel inyecta la tarjeta del form debajo del mensaje
  del bot, **una sola vez por sesión**.
- **Estado:** se reutiliza el flag `leadCaptured` que ya maneja el panel. Si el
  visitante ya envió el form (o ya fue capturado por extracción), no se vuelve a
  mostrar; en su lugar, confirmación *"✅ ¡Listo! Te contactamos a la
  brevedad."*
- **Persistencia ligera:** marcar en `localStorage` (junto al `chatbot-session-id`)
  que esta sesión ya dejó el contacto, para no re-mostrar el form al reabrir.

### 2. Backend — reusar `capture-lead`

`app/api/chatbot/capture-lead/route.ts` ya recibe
`{ sessionId, conversacionId, nombre, telefono }`, deduplica y hace upsert del
lead vía `upsertLeadFromConversation`. El mini-form hace `POST` a este endpoint.

Ajustes mínimos:

- **Score explícito alto:** un lead que **pidió** ser contactado es la señal más
  fuerte. Marcarlo con `score ≈ 85` para que:
  - el trigger `auto_calificar_lead` lo promueva a `CALIFICADO` (umbral 70), y
  - aparezca como **"caliente no visto"** en el panel de superadmin (umbral 80),
    encendiendo el badge — **esa es la alerta del equipo**.
- **Interés legible:** `interes = "Pidió ser contactado (chatbot)"` cuando viene
  del form (distinguible de la extracción automática).
- Mantener `origen = CHATBOT`.

Decidir dónde fijar el score: el camino más limpio es que `capture-lead` acepte
un origen explícito (p.ej. `fuente: "form"`) y pase `score`/`interes` a
`upsertLeadFromConversation`. Verificar la firma actual de
`upsertLeadFromConversation` para extender sin romper el camino de extracción
automática (que no debe cambiar de score).

### 3. Empujón del bot hacia el form (prompt)

En `app/api/chatbot/route.ts`, sección de estrategia de captación del system
prompt: cuando se detecta interés, el bot debe **invitar a usar el form**
("dejame tu nombre y WhatsApp acá abajo y te contactamos") en lugar de pedir el
contacto en prosa y esperar a extraerlo. El form sigue siendo el mecanismo de
captura; el prompt sólo lo refuerza.

## Componentes y responsabilidades

- `LeadCaptureForm` (nuevo): UI del form + validación + `POST` a `capture-lead`.
  Entrada: `sessionId`, `conversacionId`, callback `onCaptured`. No conoce la
  lógica del chat.
- `chatbot-panel.tsx` (editar): decide cuándo mostrar el form (botón fijo +
  auto-aparición por interés), pasa props, maneja el estado `leadCaptured` y la
  marca en `localStorage`.
- `capture-lead` route (editar): acepta la fuente del form, fija score/interes.
- `upsert-lead.ts` (revisar/extender): permitir score/interes explícitos sin
  alterar el camino de extracción automática.
- `route.ts` system prompt (editar): nudge al form.

## Manejo de errores

- `POST` falla → el form muestra error inline y permite reintentar; no se pierde
  lo escrito.
- Si no hay `conversacionId` todavía (visitante que toca el botón fijo sin haber
  mandado ningún mensaje): **`capture-lead` crea la conversación si falta** (a
  partir del `sessionId`), para no perder al visitante que va directo al botón.
  El form siempre envía `sessionId`; `conversacionId` es opcional.

## Testing

- Unit: validación del form (nombre vacío, WhatsApp con pocos dígitos, limpieza
  a dígitos).
- Unit/API: `capture-lead` con fuente "form" fija `score≈85`, `estado` resultante
  `CALIFICADO`, `origen CHATBOT`; dedup por teléfono no duplica.
- Verificar que el camino de extracción automática conserva su score.

## Prerrequisitos / ops

Ninguno nuevo para esta entrega (no se usa WhatsApp ni email para el aviso).
Nota aparte (fuera de alcance): `RESEND_API_KEY` está mal configurada en prod —
los emails de aviso de lead y de órdenes fallan con "API key is invalid". El
panel de superadmin cubre el aviso mientras tanto.
