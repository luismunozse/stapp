# Guía completa: Conectar WhatsApp (Meta Cloud API) a STApp

> Manual paso a paso para vincular un número de WhatsApp Business con STApp y
> automatizar las notificaciones de órdenes de servicio (estado, presupuesto,
> listo para retirar, garantías, cobranzas, etc.).
>
> **Pensado para quien nunca usó Meta for Developers.** Andá leyendo tranquilo,
> no hace falta saber programar: el código ya está hecho en STApp, vos solo
> configurás del lado de Meta y pegás 3 datos en una pantalla.

---

## 0. Lo importante antes de empezar

**No vas a tocar código.** STApp ya tiene toda la integración construida:

- Pantalla de configuración: **STApp → Configuración → WhatsApp Business**
  (solo visible para usuarios con rol **ADMIN**).
- Envío de mensajes, recepción de respuestas, encriptación de credenciales y
  webhook: ya implementados.
- 27 plantillas de mensajes ya escritas (estado de orden, presupuesto, listo
  para retirar, garantía, cobranza, encuestas, etc.).
- Cuando un cliente responde **"sí", "dale", "ok", "aprobado"** a un
  presupuesto, STApp **aprueba la orden automáticamente** y registra el evento.

**Lo único que falta es la parte de Meta:** crear la app, conseguir las
credenciales y pegarlas en STApp. Eso es lo que cubre esta guía.

**Requisito de plan:** la función WhatsApp requiere el plan **Profesional**.
Si tu organización no lo tiene, la pantalla te lo va a avisar.

---

## 1. Conceptos mínimos de Meta (leé esto, evita el 90% de los dolores)

WhatsApp Business API (la versión "Cloud API" de Meta) funciona distinto a tu
WhatsApp personal. Tres ideas que tenés que entender:

### 1.1 La "ventana de 24 horas"
- Cuando un cliente **te escribe**, se abre una ventana de **24 horas** durante
  la cual le podés mandar **texto libre** (cualquier mensaje).
- Pasadas las 24 horas sin que el cliente responda, **NO podés mandar texto
  libre**. Solo podés iniciar la conversación con una **plantilla aprobada**
  (template).

### 1.2 Plantillas (templates)
- Una plantilla es un mensaje con formato fijo que Meta **revisa y aprueba**
  antes de permitir su uso (tarda de minutos a 24 hs).
- Sirven para **iniciar** conversaciones fuera de la ventana de 24 hs
  (ej.: avisar "su equipo está listo" 3 días después).
- STApp soporta enviar plantillas aprobadas y también texto libre dentro de la
  ventana de 24 hs.

### 1.3 Tokens de acceso (access token)
- Es la "llave" con la que STApp se autentica ante Meta.
- El token que Meta te da al principio es **temporal (dura 24 hs)** — sirve para
  probar.
- Para producción necesitás un **token permanente** (System User token), que no
  vence. Lo vemos en la sección 8.

---

## 2. Requisitos previos

Tené a mano:

1. **Una cuenta de Facebook** (personal sirve; se usa solo para entrar al panel
   de desarrolladores). No se publica nada en tu Facebook.
2. **Un número de teléfono** para WhatsApp Business. Importante:
   - Puede ser un número **nuevo** o uno que **NO** tengas registrado en la app
     normal de WhatsApp / WhatsApp Business.
   - Si el número ya está en uso en WhatsApp, primero hay que **borrarlo de esa
     app** para poder migrarlo a la API.
   - **Para probar no necesitás número propio:** Meta te da un **número de
     prueba gratis** al instante (ver sección 4).
3. **Acceso ADMIN** en STApp.
4. El **dominio de tu STApp** (ej.: `tutaller.stapp.com.ar`). Lo necesitás para
   el webhook.

---

## 3. Crear la app en Meta for Developers

1. Entrá a **https://developers.facebook.com** e iniciá sesión con tu cuenta de
   Facebook.
2. Arriba a la derecha: **My Apps → Create App** (Crear app).
3. Te va a preguntar el caso de uso. Elegí **"Other"** (Otro) → **Next**.
4. Tipo de app: elegí **"Business"** → **Next**.
5. Completá:
   - **App name**: un nombre interno (ej.: "STApp WhatsApp Taller").
   - **App contact email**: tu email.
   - **Business portfolio**: si ya tenés una cuenta de Meta Business, elegila;
     si no, se crea una nueva más adelante.
6. **Create App**. Te puede pedir la contraseña de Facebook.

> ℹ️ Si es tu primera app, Meta puede pedirte verificar tu identidad
> (teléfono/email). Es normal y rápido.

---

## 4. Agregar el producto "WhatsApp" y obtener número de prueba

1. Ya dentro de la app, en el panel vas a ver **"Add products to your app"**.
2. Buscá la tarjeta **WhatsApp** → **Set up** (Configurar).
3. Meta te pide asociar una **Meta Business Account**. Si no tenés, elegí
   **"Create a business account"** y poné el nombre de tu negocio.
4. Vas a llegar a la pantalla **WhatsApp → API Setup** (Configuración de la API).

Acá Meta te da **gratis y al instante**:

- **Un número de prueba** (un número de Meta, ej.: +1 555…). Sirve para probar
  sin tener número propio.
- **Hasta 5 números de destino** que podés agregar para enviarles mensajes de
  prueba (tenés que cargar y verificar tu propio celular para recibir las
  pruebas).
- Un **token de acceso temporal** (dura 24 hs).

> ✅ **La famosa "espera" de Meta es un mito para desarrollo.** El número de
> prueba funciona inmediatamente. La espera/verificación recién aparece cuando
> querés usar **tu propio número** y mandar a volumen (producción).

---

## 5. Anotar los 3 datos que necesita STApp

En la pantalla **WhatsApp → API Setup** vas a encontrar:

| Dato en Meta | Cómo se ve | Dónde va en STApp |
|---|---|---|
| **Phone number ID** | número largo, ej. `123456789012345` | Campo **Phone Number ID** |
| **WhatsApp Business Account ID** (WABA ID) | número largo | Campo **Business Account ID** (opcional) |
| **Temporary access token** | texto largo `EAAG...` | Campo **Access Token** |

⚠️ **Cuidado:** el "Phone number ID" **NO** es el número de teléfono (+54...).
Es un ID numérico que identifica ese número dentro de Meta. Está justo arriba
del número, etiquetado como *"Phone number ID"*.

Copiá los 3 valores. El **token temporal** sirve para la primera prueba; después
lo reemplazamos por uno permanente (sección 8).

---

## 6. Cargar las credenciales en STApp

1. Entrá a STApp como **ADMIN**.
2. Andá a **Configuración → WhatsApp Business**.
3. Elegí el proveedor **Meta** (es el de por defecto).
4. Pegá:
   - **Phone Number ID** → el `Phone number ID` de Meta.
   - **Business Account ID** → el WABA ID (opcional, pero conviene cargarlo).
   - **Access Token** → el token (temporal por ahora).
5. **Guardar**.

STApp va a **verificar las credenciales contra Meta** automáticamente. Si están
bien, vas a ver el estado **"Verificado"** y el nombre del número. El token se
guarda **encriptado** en la base (AES-256-GCM); nunca queda en texto plano.

> Si da error de credenciales: revisá que copiaste el **Phone number ID** (no el
> número) y que el token no tenga espacios al pegarlo.

---

## 7. Configurar el Webhook (para recibir respuestas de clientes)

El webhook es la "dirección" a la que Meta le avisa a STApp cuando un cliente
responde o cuando un mensaje se entrega/lee. **Sin esto, STApp envía pero no
"escucha"** (no se auto-aprueban presupuestos ni se actualizan los estados de
entrega).

### 7.1 Datos que te da STApp
En la misma pantalla **Configuración → WhatsApp Business** vas a ver:

- **Webhook URL** (Callback URL): algo como
  `https://tutaller.stapp.com.ar/api/whatsapp/webhook`
- **Verify Token**: una cadena larga generada automáticamente
  (campo de solo lectura). Copiala.

### 7.2 Cargarlos en Meta
1. En tu app de Meta: menú izquierdo **WhatsApp → Configuration**
   (Configuración).
2. Sección **Webhook** → **Edit** (Editar).
3. Pegá:
   - **Callback URL** → la Webhook URL de STApp.
   - **Verify token** → el Verify Token que copiaste de STApp
     (tienen que coincidir **exactamente**).
4. **Verify and save**. Meta llama a la URL una vez para validar; si el token
   coincide, queda en verde.
5. En **Webhook fields**, suscribí el campo **`messages`** (botón *Subscribe* /
   *Manage*). Ese es el evento de mensajes entrantes y estados.

> 🔒 El Verify Token es por organización y ya viene generado en STApp. No lo
> inventes ni lo cambies; solo copialo tal cual.

---

## 8. Token permanente (para producción)

El token temporal **vence a las 24 hs** y se te corta el servicio. Para
producción generá un **token de System User** que no expira:

1. Andá a **https://business.facebook.com** → **Business Settings**
   (Configuración del negocio).
2. **Users → System users** → **Add** (Agregar). Creá uno con rol **Admin**
   (ej.: "STApp Integration").
3. Seleccionalo → **Add Assets** → asigná tu **app** y tu **WhatsApp Account
   (WABA)** con permisos completos.
4. **Generate new token**:
   - Elegí tu app.
   - **Token expiration: Never** (Nunca).
   - Permisos: marcá **`whatsapp_business_messaging`** y
     **`whatsapp_business_management`**.
5. **Generate token** y **copialo ahora** (no se vuelve a mostrar).
6. Volvé a STApp → **Configuración → WhatsApp Business** → reemplazá el campo
   **Access Token** por este nuevo token permanente → **Guardar**.

> Guardá el token permanente en un lugar seguro (gestor de contraseñas). Si lo
> perdés, generás uno nuevo y repetís el paso 6.

---

## 9. Probar el envío

1. Asegurate de que el cliente de prueba esté en tu lista de números permitidos
   (con número de prueba de Meta) o que ya estés en producción (sección 10).
2. En STApp, abrí una **orden de servicio** de un cliente cuyo teléfono sea el
   de prueba.
3. Usá la acción de **enviar notificación por WhatsApp** (ej.: "Informar
   presupuesto" o "Estado actual").
4. Debería llegar el mensaje al WhatsApp del cliente.
5. **Probá la respuesta automática:** desde el celular del cliente respondé
   **"sí"** o **"dale"** a un mensaje de presupuesto. La orden tiene que pasar
   sola de **PRESUPUESTADO → APROBADO** y quedar registrado el evento
   "Presupuesto aprobado por el cliente vía WhatsApp".

> Recordá la ventana de 24 hs: el texto libre solo llega si el cliente te
> escribió en las últimas 24 hs. Fuera de eso, necesitás plantillas aprobadas
> (sección 11).

---

## 10. Pasar a producción (usar tu número real)

Mientras estás con el número de prueba, solo podés escribirles a los 5 números
cargados a mano. Para mandar a cualquier cliente:

1. **Agregar tu número propio** a la WABA:
   - **WhatsApp → API Setup → Add phone number**.
   - Cargá el número (recordá: no debe estar activo en la app normal de
     WhatsApp).
   - Verificalo por **SMS o llamada**.
   - Poné el **nombre para mostrar** (display name) del negocio — Meta lo revisa
     (puede tardar).
2. **Verificación del negocio (Business Verification):**
   - En **Business Settings → Security Center** vas a ver si te piden verificar
     el negocio (documentación de la empresa).
   - Hasta verificar, hay un **límite de 250 conversaciones iniciadas por día**.
     Verificado, sube a 1.000 y luego escala automáticamente.
3. Una vez con número propio verificado y token permanente cargado en STApp,
   **ya podés notificar a todos tus clientes**.

> Esta es la única parte donde puede haber demora (revisión de display name y/o
> verificación de negocio). No bloquea las pruebas: podés tener todo andando con
> el número de prueba mientras tanto.

---

## 11. Plantillas (para iniciar conversaciones fuera de las 24 hs)

Para mandar el típico "su equipo está listo" días después (cuando la ventana de
24 hs ya cerró), necesitás una **plantilla aprobada**:

1. Andá a **https://business.facebook.com → WhatsApp Manager → Message
   Templates** (o desde tu app: **WhatsApp → Manage templates**).
2. **Create template**:
   - **Category**: **Utility** (para avisos transaccionales como estado de
     orden) — es la más barata y de aprobación más fácil. *Marketing* es para
     promociones.
   - **Name**: en minúsculas con guiones bajos, ej. `orden_lista_retirar`.
   - **Language**: Español.
   - **Body**: el texto, con variables `{{1}}`, `{{2}}`, etc. para los datos
     dinámicos (nombre del cliente, número de orden…).
3. **Submit**. Meta la revisa (minutos a 24 hs).
4. Una vez **aprobada**, STApp puede enviarla con sus variables. Las plantillas
   internas de STApp (estado, presupuesto, listo para retirar, etc.) están
   pensadas para mapear a estas plantillas.

> 💡 Empezá con pocas plantillas Utility: *presupuesto*, *listo para retirar*,
> *aviso de demora*. Son las de mayor uso real.

---

## 12. Costos (orientativo)

Meta cobra **por conversación iniciada**, no por mensaje suelto:

- **Recibir** mensajes del cliente y responder dentro de las 24 hs:
  el "service" tiene un esquema gratuito amplio.
- **Iniciar** vos la conversación con plantilla:
  - **Utility** (transaccional): tarifa baja.
  - **Marketing**: tarifa más alta.
- Las tarifas varían por país (Argentina tiene su tabla). Consultá la tarifa
  vigente en la documentación de precios de WhatsApp de Meta.

Para un taller con notificaciones de orden, el costo mensual suele ser bajo
porque la mayoría son conversaciones *utility* o respuestas dentro de 24 hs.

---

## 13. Problemas comunes (troubleshooting)

| Síntoma | Causa probable | Solución |
|---|---|---|
| "Credenciales inválidas" al guardar | Copiaste el número en vez del Phone Number ID | Usá el **Phone number ID** (no el +54...) |
| Webhook no verifica en Meta | Verify Token no coincide | Copiá **exacto** el token de STApp, sin espacios |
| Webhook no verifica | URL mal escrita o sitio no accesible | La URL debe ser `https://...tu-dominio.../api/whatsapp/webhook` y estar online |
| Dejó de enviar a las 24 hs | Token temporal venció | Generá el **token permanente** (sección 8) |
| No llega texto libre | Pasaron +24 hs sin respuesta del cliente | Usá una **plantilla aprobada** |
| Solo puedo enviar a 5 números | Estás con el número de prueba | Pasá a producción con número propio (sección 10) |
| El cliente respondió "sí" pero no se aprobó | Webhook sin suscribir `messages`, o teléfono del cliente no coincide con el cargado | Revisá suscripción `messages` y el teléfono del cliente en STApp |

---

## 14. Checklist final

- [ ] Cuenta de Facebook + app **Business** creada en developers.facebook.com
- [ ] Producto **WhatsApp** agregado, Meta Business Account asociada
- [ ] **Phone Number ID**, **WABA ID** y **Access Token** copiados
- [ ] Cargados en **STApp → Configuración → WhatsApp Business** → estado
      **Verificado**
- [ ] **Webhook URL** + **Verify Token** cargados en Meta y verificados
- [ ] Campo **`messages`** suscrito en el webhook
- [ ] Prueba de **envío** OK
- [ ] Prueba de **respuesta automática** ("sí" → orden APROBADA) OK
- [ ] **Token permanente** (System User) generado y cargado en STApp
- [ ] (Producción) Número propio agregado y verificado
- [ ] (Producción) Verificación de negocio iniciada/completada
- [ ] Plantillas Utility básicas creadas y aprobadas

---

## Resumen en 1 minuto

1. Creás app **Business** en developers.facebook.com → agregás **WhatsApp**.
2. Meta te da **número de prueba + Phone Number ID + token** al instante.
3. Pegás esos 3 datos en **STApp → Configuración → WhatsApp**.
4. Copiás el **Webhook URL + Verify Token** de STApp y los cargás en Meta;
   suscribís `messages`.
5. Probás envío y respuesta automática.
6. Para producción: **token permanente** + **número propio verificado** +
   **plantillas aprobadas**.

El código ya está. Esto es todo configuración.

---

### Enlaces útiles
- Panel de desarrolladores: https://developers.facebook.com
- Business Manager: https://business.facebook.com
- Documentación Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
- Plantillas (Message Templates): https://business.facebook.com/wa/manage/message-templates
