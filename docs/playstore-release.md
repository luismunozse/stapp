# Release a Google Play Store — STApp (APK/AAB)

La APK es un shell Capacitor que carga `https://stapp.com.ar/app-entry`. Las mejoras
de UI web llegan solas; solo se sube una APK/AAB nueva cuando cambia config nativa
(permisos, ícono, versión, plugins).

## Hecho en código

- `android/` se versiona (antes estaba en `.gitignore`), para persistir la config de
  release. `android/.gitignore` excluye build artifacts, keystores y secretos.
- **Firma de release**: `android/app/build.gradle` lee `android/keystore.properties`
  (gitignored). Sin ese archivo, el build de debug sigue andando.
- **AAB**: `npm run cap:build:aab` → `android/app/build/outputs/bundle/release/app-release.aab`.
- **Permisos**: `CAMERA` y `POST_NOTIFICATIONS` en el `AndroidManifest.xml`.
- **Seguridad**: `allowBackup="false"` (datos sensibles; la app no guarda data local relevante).
- **Ícono y splash**: generados desde `public/icon-512.svg`, misma marca que la PWA.
  `scripts/generate-icons.mjs` escribe las fuentes en `assets/` y `npm run cap:assets`
  las expande a los recursos nativos. Ya no queda nada del placeholder de Capacitor.
- **Versionado**: `versionCode`/`versionName` se pueden overridear sin editar el
  gradle (ver "Subir la versión" abajo).
- **FileProvider**: `file_paths.xml` expone solo el cache dir privado de la app.
  Antes declaraba `<external-path path="." />`, que mapeaba la raíz del
  almacenamiento externo compartido.
- **Push nativas**: `firebase-admin` ahora está en `package.json`. `lib/push/send.ts`
  lo importa dinámicamente, así que sin el paquete los envíos a FCM se salteaban en
  silencio incluso con `FCM_SERVICE_ACCOUNT` configurada.
- **App Links**: `/.well-known/assetlinks.json` se sirve desde
  `app/api/public/assetlinks/route.ts` (vía rewrite en `next.config.js`), leyendo la
  huella de `ANDROID_CERT_SHA256`. Reemplaza al archivo estático que había en
  `public/.well-known/`, que publicaba la huella literal
  `REPLACE_WITH_RELEASE_KEYSTORE_SHA256` — con eso Android nunca podía verificar.
  Ahora la huella se setea por entorno (sin deploy) y las mal formadas se descartan.
- **Privacidad**: `app/legal/privacidad/page.tsx` cubre cámara, notificaciones push,
  token de dispositivo y los procesadores externos — es lo que tiene que respaldar al
  Data Safety form.

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

### 3. Build y subida
```bash
npm run cap:build:aab
```
Subir el `.aab` a Play Console (no a Supabase; ese flujo `cap:upload:apk` es solo
para sideload/debug). Primer envío: completar ficha de la tienda, screenshots,
feature graphic (1024x500), descripción y categoría.

### 4. Data Safety form (Play Console)
Declarar: email/nombre, datos de clientes/órdenes, token FCM, fotos (cámara);
compartidos con Supabase/MercadoPago; cifrado en tránsito. La política de privacidad
(`https://stapp.com.ar/legal/privacidad`) ya cubre esos puntos — si cambiás lo que
declarás en el form, actualizala para que sigan coincidiendo.

### 5. App Links — setear `ANDROID_CERT_SHA256`
La ruta ya existe; solo falta la huella. Con Play App Signing es la del certificado
de Google (Play Console → Release → Setup → App signing), **no** la del keystore
local: Play re-firma el AAB al distribuir. Para una APK de sideload:
```bash
keytool -list -v -keystore android/stapp-release.jks -alias stapp
```
Se aceptan varias separadas por coma. Verificar después con:
```bash
curl -sS https://stapp.com.ar/.well-known/assetlinks.json
```
Sin esto los links abren en el navegador (no bloquea publicar).

## Subir la versión en cada release

Play rechaza un AAB cuyo `versionCode` ya exista. No hace falta editar el gradle:
```bash
npm run cap:sync
cd android && ./gradlew bundleRelease -PstappVersionCode=2 -PstappVersionName=1.1.0
```
También funciona por entorno (`STAPP_VERSION_CODE` / `STAPP_VERSION_NAME`). Sin
override, el default es `1` / `1.0.0`.

## Regenerar ícono y splash

Las fuentes de `assets/` se derivan de `public/icon-512.svg`, así que un cambio de
marca se hace una sola vez:
```bash
node scripts/generate-icons.mjs   # public/ (web+PWA) y assets/ (fuentes nativas)
npm run cap:assets                # expande assets/ a android/app/src/main/res
```

## Hardening pendiente (no bloqueante)

- `minifyEnabled false` en el build de release: activar R8 reduce el tamaño, pero hay
  que verificar que no rompa los plugins de Capacitor.
- El shell nativo no registra el Service Worker (`components/pwa/pwa-updater.tsx` hace
  `if (isNativePlatform()) return`), así que la app de la store no tiene el offline ni
  el caché que sí tiene la PWA en el navegador.
