# Release a Google Play Store — STApp (APK/AAB)

La APK es un shell Capacitor que carga `https://stapp.com.ar/app-entry`. Las mejoras
de UI web llegan solas; solo se sube una APK/AAB nueva cuando cambia config nativa
(permisos, ícono, versión, plugins).

## Hecho en código (este branch)

- `android/` ahora se versiona (antes estaba en `.gitignore`), para persistir la
  config de release. `android/.gitignore` excluye build artifacts, keystores y secretos.
- **Firma de release**: `android/app/build.gradle` lee `android/keystore.properties`
  (gitignored). Sin ese archivo, el build de debug sigue andando.
- **AAB**: `npm run cap:build:aab` → `android/app/build/outputs/bundle/release/app-release.aab`.
- **Permisos**: agregados `CAMERA` y `POST_NOTIFICATIONS` al `AndroidManifest.xml`.
- **Seguridad**: `allowBackup="false"` (datos sensibles; la app no guarda data local relevante).

## Pendiente — acciones tuyas (consolas externas)

### 1. Keystore de firma (BLOQUEANTE)
```bash
cd android
keytool -genkey -v -keystore stapp-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias stapp
cp keystore.properties.example keystore.properties   # completar con tus passwords
```
Guardá el `.jks` y las contraseñas en lugar seguro CON BACKUP. Si los perdés, no
podés volver a publicar updates de la app.

### 2. Firebase / Push (BLOQUEANTE para notificaciones)
- Crear proyecto en Firebase Console, agregar app Android con package `ar.com.stapp.app`.
- Descargar `google-services.json` y ponerlo en `android/app/google-services.json`.
- Configurar `FCM_SERVICE_ACCOUNT` en el server (ver `docs/PUSH_NOTIFICATIONS_SETUP.md`).
- Sin esto, las push nativas no funcionan (el build sí compila).

### 3. Ícono y splash (BLOQUEANTE de calidad)
El ícono actual es el placeholder de Capacitor (robot de Android). Reemplazar con el
logo de STApp. Recomendado:
```bash
npm i -D @capacitor/assets
# poner el logo en assets/icon.png (1024x1024) y assets/splash.png (2732x2732)
npx @capacitor/assets generate --android
```

### 4. Build y subida
```bash
npm run cap:build:aab
```
Subir el `.aab` a Play Console (no a Supabase; ese flujo `cap:upload:apk` es solo
para sideload/debug). Primer envío: completar ficha de la tienda, screenshots,
feature graphic (1024x500), descripción y categoría.

### 5. Data Safety form (Play Console)
Declarar: email/nombre, datos de clientes/órdenes, token FCM, fotos (cámara);
compartidos con Supabase/MercadoPago; cifrado en tránsito. Política de privacidad:
`https://stapp.com.ar/legal/privacidad` (revisar que mencione cámara, push y device id).

### 6. App Links (opcional, para abrir links de stapp.com.ar en la app)
El `AndroidManifest` tiene `autoVerify="true"` para `https://stapp.com.ar`. Requiere
publicar `https://stapp.com.ar/.well-known/assetlinks.json` con el SHA-256 del
keystore de release. Sin esto, los links abren en el navegador (no bloquea publicar).

## Hardening pendiente (no bloqueante)
- `versionCode`/`versionName` en `android/app/build.gradle`: subir en cada release.
- `android/app/src/main/res/xml/file_paths.xml` usa `path="."` (amplio). Restringir al
  dir de la app si no rompe el plugin de cámara.
- Confirmar `firebase-admin` instalado en el server (los imports son dinámicos).
- `npx cap sync` para resolver el `launchAutoHide` (config.ts=false es el correcto).
