# Play Store — Ficha + Data Safety + Runbook v1.0.0

Artefacto de lanzamiento para `ar.com.stapp.app`. Todo lo de esta página es para
**copiar/pegar en Play Console** o ejecutar en consolas externas. Complementa
[`docs/playstore-release.md`](./playstore-release.md), que es la fuente de verdad del
estado técnico (build, firma, versionado, App Links). Si algo de esta página
contradice a esa, manda `playstore-release.md`.

> ⛔ **Cuenta Personal**: Google exige Closed Testing con **12+ testers durante 14
> días corridos** antes de habilitar producción. El objetivo inmediato es entrar a
> Closed Testing cuanto antes para arrancar ese reloj.

---

## 1. Ficha de la tienda (Store listing)

| Campo | Valor |
|---|---|
| Nombre de la app | `STApp` |
| Email de contacto | `soporte@stapp.com.ar` |
| Sitio web | `https://stapp.com.ar` |
| Política de privacidad | `https://stapp.com.ar/legal/privacidad` |
| Categoría | Empresa (Business) |
| Etiqueta de contenido | Apto para todos / sin contenido sensible |

**Descripción corta** (máx 80 caracteres):
```
Gestión de reparaciones, órdenes, inventario y ventas para tu negocio.
```

**Descripción larga** (máx 4000 caracteres):
```
STApp es el sistema de gestión para talleres y negocios de reparación, venta y
servicio técnico. Llevá tus órdenes de trabajo, clientes, inventario, caja y
ventas desde un solo lugar, en la compu o en el celular.

Con STApp podés:
• Crear y seguir órdenes de reparación con estados, fotos y comprobantes.
• Administrar clientes y su historial.
• Controlar inventario, stock y proveedores.
• Punto de venta (POS) con múltiples métodos de pago.
• Caja diaria con arqueo y movimientos.
• Cotizaciones y facturación.
• Notificaciones push de órdenes, turnos y avisos del sistema.
• Acceso por roles (administrador, vendedor, técnico).

STApp funciona como servicio en la nube: tus datos están disponibles y
sincronizados en todos tus dispositivos. Pensado para negocios de Argentina y
Latinoamérica.
```

---

## 2. Recursos gráficos (assets)

| Asset | Requisito Google | Estado |
|---|---|---|
| Ícono de la app | 512×512 PNG 32-bit | ✅ `public/icon-512.png` (verificar alpha/tamaño exacto al subir) |
| Feature graphic | 1024×500 PNG/JPG | ✅ Provisto por el owner: `docs/playstore-assets/feature-graphic.png` (no versionado en el repo) |
| Screenshots teléfono | mín. 2, máx 8 (16:9 / 9:16) | ✅ 4 provistos por el owner en `docs/playstore-assets/`: `screenshot-1-dashboard.png`, `screenshot-2-ordenes.png`, `screenshot-3-clientes.png`, `screenshot-4-inventario.png` (no versionados) |
| Screenshots tablet | opcional | — |

> Las imágenes viven fuera de git (carpeta local `docs/playstore-assets/` del owner);
> se suben directo a Play Console. Antes de subir, verificar dimensiones y que no
> muestren datos reales de clientes.

---|---|---|
| Ícono de la app | 512×512 PNG 32-bit | ✅ `public/icon-512.png` (verificar alpha/tamaño exacto) |
| Feature graphic | 1024×500 PNG/JPG | ❌ **FALTA — hay que crear** |
| Screenshots teléfono | mín. 2, máx 8 (16:9 / 9:16) | ⚠️ Fuente: `shots/` y capturas reales del producto. Hay que framear |
| Screenshots tablet | opcional | — |

> Puedo ayudarte a generar el feature graphic y framear los screenshots con las
> skills de imagen. Avisame y lo armo.

---

## 3. Content rating (cuestionario IARC)

- Categoría de la app: **Utilidad / Productividad / Empresa**.
- Violencia, sexo, lenguaje, sustancias, apuestas: **No** a todo.
- ¿Comparte ubicación del usuario? **No**.
- ¿Permite interacción entre usuarios / contenido generado? **No** (uso interno del negocio).
- Resultado esperado: **Apto para todos / PEGI 3 / ESRB Everyone**.

---

## 4. Data Safety form (Seguridad de los datos)

**Prácticas generales:**
- ¿Cifrado en tránsito? **Sí** (HTTPS/TLS).
- ¿El usuario puede pedir borrado de datos? **Sí, contactando a `soporte@stapp.com.ar`.**
  ⚠️ Play exige además un **flujo de eliminación de cuenta dentro de la app y una URL
  web de borrado** para apps con creación de cuentas. Hoy no existe (ver sección 7):
  hay que resolverlo antes de pedir producción.
- ¿Recopila datos? **Sí**.
- ¿Comparte datos con terceros? **No** en el sentido de Google — Supabase (hosting)
  y MercadoPago (pagos) actúan como **proveedores de servicio** que procesan por
  cuenta de STApp, no como destinatarios independientes.

**Tipos de datos recopilados** (todos: recopilados=Sí, compartidos=No, requerido para funcionalidad de la app):

| Tipo de dato | Categoría Google | Propósito |
|---|---|---|
| Nombre, email | Personal info | Gestión de cuenta, funcionalidad |
| Datos de clientes/órdenes ingresados por el usuario | Personal info (de terceros) | Funcionalidad de la app |
| Fotos | Photos and videos | Funcionalidad (fotos de equipos/órdenes) |
| Historial de compras/ventas | Financial info | Funcionalidad |
| Interacciones en la app, búsquedas | App activity | Funcionalidad, analítica |
| Token de push (FCM) / ID de dispositivo | Device or other IDs | Notificaciones del servicio |

> Debe coincidir con `https://stapp.com.ar/legal/privacidad` (cubre cámara/fotos y
> token de push). Ojo: esa página afirma que el token de push se desactiva al cerrar
> sesión, y el código todavía no lo hace (ver sección 7).

---

## 5. Runbook — acciones tuyas (consolas externas)

### 5.1 Keystore de firma (BLOQUEANTE para el AAB) 🔑
Corré esto **vos** (la contraseña es tuya, guardala con backup; si se pierde no
podés volver a actualizar la app):
```bash
cd android
keytool -genkey -v -keystore stapp-release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias stapp
cp keystore.properties.example keystore.properties
# editar keystore.properties con storePassword / keyPassword reales
```
Backupeá `stapp-release.jks` + contraseñas en un gestor seguro (no en el repo;
`*.jks` y `keystore.properties` están gitignored).

`storeFile` en `keystore.properties` se resuelve relativo a `android/` (ver
`keystore.properties.example`). El build y la subida del AAB están en
[`playstore-release.md`](./playstore-release.md#3-build-y-subida).

### 5.2 Firebase / Push (para que push funcione day-one) 🔔
1. Firebase Console → nuevo proyecto → agregar app Android con package `ar.com.stapp.app`.
2. Descargar `google-services.json` → `android/app/google-services.json`.
3. Project settings → Service accounts → Generate new private key → pegar el JSON
   (en una línea) en env `FCM_SERVICE_ACCOUNT`.
4. `npx web-push generate-vapid-keys` → setear `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:soporte@stapp.com.ar`.
5. **Verificar que las migraciones `057_improve_notifications` y `189_web_push_subscriptions`
   estén aplicadas en producción** (sin esas tablas, no se guardan tokens).

### 5.3 Play Console + Closed Testing 📱
1. Crear cuenta de desarrollador ($25 USD) + verificación de identidad.
2. Crear la app → completar ficha (sección 1), assets (sección 2), content rating
   (sección 3), Data Safety (sección 4).
3. Subir el AAB a un track de **Closed Testing**.
4. Crear lista de testers (12+ emails) e invitarlos; que **acepten** la invitación.
5. Mantener el test **14 días** → recién ahí se habilita solicitar producción.
6. Tras subir: Play Console → Setup → App signing te muestra el **SHA-256 del App
   Signing key**. Cargalo en la variable de entorno `ANDROID_CERT_SHA256` de Vercel
   (se admiten varias separadas por coma) para que `/.well-known/assetlinks.json` lo
   sirva y los deep links de `stapp.com.ar` abran en la app. Detalle en
   [`playstore-release.md`](./playstore-release.md#5-app-links--setear-android_cert_sha256).

---

## 6. Estado del repo
Detalle completo en [`playstore-release.md`](./playstore-release.md#hecho-en-código).
- `versionCode`/`versionName` overrideables por env o `-P` (default `1` / `1.0.0`).
- `firebase-admin` en dependencies; el import dinámico en `lib/push/send.ts` maneja
  exports bajo `.default` (cubierto por `__tests__/lib/push-send-fcm-interop.test.ts`).
- Política de privacidad con cámara/fotos y token de push.
- `assetlinks.json` servido por ruta con `ANDROID_CERT_SHA256` (sin placeholder).
- Íconos/splash nativos con la marca de STApp; `file_paths.xml` limitado al cache.

### Verificación pendiente (no bloquea closed testing)
- Probar push real con el botón "Probar" en `/perfil` una vez cargados
  `FCM_SERVICE_ACCOUNT` y `google-services.json`.

---

## 7. Riesgos conocidos antes de producción
- **Eliminación de cuenta**: Play lo exige (in-app + URL web). No implementado.
- **Token de push al cerrar sesión**: la política de privacidad dice que se desactiva;
  `handleLogout` en `components/layout/navbar.tsx` no lo hace. Corregir el código o
  el texto.
- **Pagos con MercadoPago dentro de la app**: revisar la política de pagos de Google
  Play (bienes/servicios digitales vs. facturación de Play) para la suscripción.
