# Plan de Migración a App Nativa (Android/iOS)

> **Estado:** Pendiente - Priorizar validación del producto web/PWA primero
> **Fecha de creación:** 2026-01-20

---

## Situación Actual del Proyecto

El proyecto STApp cuenta con:
- **PWA completa** con Service Worker, offline support y background sync
- **Next.js 16** con API routes serverless
- **Supabase** como backend (PostgreSQL)
- **Autenticación JWT** con refresh tokens
- **Multi-tenant** con subdominios por organización

---

## Opciones para App Nativa

### Opción 1: Capacitor (Recomendado)

Convierte la PWA existente en app nativa con cambios mínimos.

**Ventajas:**
- Reutiliza ~90% del código actual
- Acceso a APIs nativas (cámara, notificaciones push, almacenamiento)
- Un solo codebase para web + iOS + Android
- La lógica de autenticación funciona igual

**Consideraciones:**
- Necesitará ajustar el Service Worker (Capacitor maneja esto diferente)
- Las fotos de órdenes usarían `@capacitor/camera` en lugar de input file
- Push notifications con `@capacitor/push-notifications` en vez de Web Push

**Instalación básica:**
```bash
npm install @capacitor/core @capacitor/cli
npx cap init
npx cap add android
npx cap add ios
```

**Plugins recomendados:**
```bash
npm install @capacitor/camera        # Fotos de órdenes
npm install @capacitor/push-notifications  # Notificaciones
npm install @capacitor/preferences   # Almacenamiento seguro
npm install @capacitor/share         # Compartir PDFs/cotizaciones
npm install @capacitor/filesystem    # Manejo de archivos
```

---

### Opción 2: React Native (Nueva app desde cero)

**Ventajas:**
- Mejor rendimiento nativo
- Acceso completo a APIs del dispositivo
- Mejor experiencia de usuario nativa

**Consideraciones:**
- Reescribir toda la UI (no se pueden usar componentes React web)
- La lógica de API y tipos TypeScript sí se pueden reutilizar
- La autenticación con Supabase funciona igual (`@supabase/supabase-js`)
- Duplica esfuerzo de mantenimiento (2 codebases)

---

### Opción 3: Expo (React Native simplificado)

**Ventajas:**
- Más fácil de configurar que React Native puro
- OTA updates sin pasar por stores
- Expo Router es similar a Next.js App Router

**Consideraciones:**
- Algunas limitaciones en módulos nativos personalizados
- Mejor para proyectos nuevos o con requisitos estándar

---

## Consideraciones Técnicas Específicas

### Autenticación

El sistema de refresh tokens ya está preparado para mobile. Solo se necesita almacenamiento seguro:

| Plataforma | Solución |
|------------|----------|
| iOS | Keychain |
| Android | EncryptedSharedPreferences |
| Capacitor | `@capacitor/preferences` (cifrado) |
| React Native | `react-native-keychain` |

```typescript
// El refresh token actual en users.refresh_token
// funciona igual para mobile
```

### Fotos de Órdenes

| Contexto | Implementación |
|----------|----------------|
| Web actual | `<input type="file" capture="camera">` |
| Capacitor | `@capacitor/camera` |
| React Native | `react-native-camera` o `expo-camera` |

**Beneficios nativos:**
- Mejor calidad de imagen
- Más control sobre la cámara
- Acceso a galería más fluido

### Notificaciones Push

**Infraestructura necesaria:**
- Firebase Cloud Messaging (FCM) para Android
- Apple Push Notification Service (APNs) para iOS
- Modificar backend para enviar a ambos servicios

**Cambios en base de datos:**
```sql
-- Agregar a tabla users o crear tabla separada
ALTER TABLE users
ADD COLUMN fcm_token TEXT,
ADD COLUMN apns_token TEXT,
ADD COLUMN device_type TEXT; -- 'ios', 'android', 'web'
```

### Almacenamiento Offline

| Contexto | Implementación |
|----------|----------------|
| PWA actual | IndexedDB |
| Nativo | SQLite (más robusto) |

**Librerías recomendadas:**
- Capacitor: `@capacitor-community/sqlite`
- React Native: `react-native-sqlite-storage` o `expo-sqlite`

### Firma Digital

| Contexto | Implementación |
|----------|----------------|
| Web actual | Canvas HTML5 |
| React Native | `react-native-signature-canvas` |
| Capacitor | Funciona el canvas actual |

### MercadoPago

- Verificar SDK oficial para mobile
- Puede requerir implementación específica para deep links de pago
- Revisar políticas de Apple sobre pagos in-app (30% comisión)

---

## Recomendación de Implementación por Fases

### Fase 1: Corto Plazo (Capacitor)
- Empaquetar PWA actual con Capacitor
- Mínimo esfuerzo, máximo resultado
- Publicar en stores rápidamente para validación

### Fase 2: Mediano Plazo (Mejoras Nativas)
- Migrar cámara a `@capacitor/camera`
- Implementar push notifications nativas
- Almacenamiento seguro de tokens con Keychain/EncryptedPrefs

### Fase 3: Largo Plazo (Opcional)
- Si se requiere mejor rendimiento, considerar React Native/Expo
- Reutilizar tipos TypeScript, lógica de negocio y APIs
- Versión 2.0 completamente nativa

---

## Checklist Pre-Migración

### Cuentas y Certificados
- [ ] Cuenta de desarrollador Apple ($99/año)
- [ ] Cuenta de desarrollador Google Play ($25 único)
- [ ] Certificados de firma iOS (provisioning profiles)
- [ ] Keystore para firma Android

### Infraestructura
- [ ] Proyecto Firebase configurado
- [ ] FCM habilitado para Android
- [ ] Certificado APNs para iOS
- [ ] Deep links configurados para dominio

### Código
- [ ] Adaptar Service Worker para Capacitor
- [ ] Implementar almacenamiento seguro de tokens
- [ ] Crear endpoints para registro de device tokens
- [ ] Adaptar componente de cámara

### Legal y Stores
- [ ] Política de privacidad actualizada para mobile
- [ ] Términos de servicio actualizados
- [ ] Screenshots para stores
- [ ] Descripción de la app
- [ ] Revisar políticas de pagos in-app (MercadoPago)

---

## Recursos Útiles

- [Documentación Capacitor](https://capacitorjs.com/docs)
- [Capacitor + Next.js Guide](https://capacitorjs.com/docs/getting-started/with-nextjs)
- [React Native Docs](https://reactnative.dev/docs/getting-started)
- [Expo Docs](https://docs.expo.dev/)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [Apple Push Notifications](https://developer.apple.com/documentation/usernotifications)

---

## Notas

- Prioridad actual: Validar producto web/PWA al 100%
- La PWA actual ya ofrece experiencia cercana a nativa
- Evaluar métricas de uso antes de invertir en app nativa
- Considerar feedback de usuarios sobre necesidad real de app en stores
