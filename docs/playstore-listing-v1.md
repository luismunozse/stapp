# Play Store — Ficha + Data Safety + Runbook v1.0.0

Artefacto de lanzamiento para `ar.com.stapp.app`. Todo lo de esta página es para
**copiar/pegar en Play Console** o ejecutar en consolas externas. Complementa
`docs/playstore-release.md` (estado técnico del repo).

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
- ¿El usuario puede pedir borrado de datos? **Sí** (configuración de cuenta / contacto a soporte).
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

> Coherencia verificada con `https://stapp.com.ar/legal/privacidad`
> (incluye cámara/fotos y token de push tras la actualización de este branch).

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

Cuando exista `android/keystore.properties`, avisame y buildeo el AAB.

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
   Signing key**. Copialo a `public/.well-known/assetlinks.json` (reemplaza el
   placeholder) y deployá, para que los deep links de `stapp.com.ar` abran en la app.

---

## 6. Estado del repo (hecho en `release/android-v1`)
- `versionName` → `1.0.0`.
- `firebase-admin` agregado a dependencies (FCM server-side).
- Política de privacidad: agregados cámara/fotos + token de push (coherencia Data Safety).
- `assetlinks.json` scaffoldeado (placeholder de SHA-256 pendiente de Play App Signing).

### Verificación pendiente (no bloquea closed testing)
- Interop de `await import("firebase-admin")` en `lib/push/send.ts` (exports bajo
  `.default` en v14) — probar push real con el botón "Probar" en `/perfil`.
