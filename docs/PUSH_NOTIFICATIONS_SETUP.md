# Push Notifications — Setup Guide

STApp dispatches notifications over **two transports**:

| Transport | Audience | Library | Token store |
|---|---|---|---|
| Web Push (VAPID) | PWA / desktop browsers | `web-push` | `web_push_subscriptions` |
| FCM v1 | Capacitor Android wrapper | `firebase-admin` | `push_tokens` |

The codebase is wired end-to-end. Setup = installing the two server packages and adding env vars. Without configuration, the dispatcher logs a one-line skip and the rest of the app keeps running.

---

## 1. Install server packages

```bash
npm i web-push firebase-admin
```

Both are optional `dynamic import` in `lib/push/send.ts`. Apps that only want one transport can install only one.

---

## 2. Generate VAPID keys (Web Push)

```bash
npx web-push generate-vapid-keys
```

Output:

```
=======================================
Public Key:
BLc4_h7Q...   (Base64URL, ~87 chars)

Private Key:
Hp9xy...      (Base64URL, ~43 chars)
=======================================
```

Add to `.env`:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BLc4_h7Q...
VAPID_PUBLIC_KEY=BLc4_h7Q...
VAPID_PRIVATE_KEY=Hp9xy...
VAPID_SUBJECT=mailto:soporte@stapp.com.ar
```

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` ships to the browser; the hook uses it as `applicationServerKey` in `pushManager.subscribe()`.
- `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` are server-only and configure `web-push` via `setVapidDetails`.

---

## 3. FCM service account (native Android)

1. Firebase console → Project settings → Service accounts → **Generate new private key**. Downloads a JSON file.
2. Paste the whole JSON as a single-line string:

```env
FCM_SERVICE_ACCOUNT={"type":"service_account","project_id":"stapp-...","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","client_id":"...",...}
```

3. The Capacitor app needs `google-services.json` placed in `android/app/`. Get it from Firebase console → Project settings → General → "Your apps" → Android app → google-services.json. (This file is gitignored under `android/`.)

---

## 4. Database

Run migrations 057 (push_tokens) and 189 (web_push_subscriptions). Both already exist in `supabase/migrations/`.

---

## 5. Use it

### Send to one user

```ts
import { sendPushToUser } from "@/lib/push/send"

await sendPushToUser(userId, {
  title: "Nueva orden asignada",
  body: "#CEL040 — Galaxy A55 — Diego Alanis",
  path: "/ordenes/abc123",
  tag: "orden-asignada",
})
```

### Send to multiple users

```ts
import { sendPushToUsers } from "@/lib/push/send"

await sendPushToUsers([userId1, userId2], { title: "...", body: "..." })
```

### Broadcast to an org

```ts
import { sendPushToOrganization } from "@/lib/push/send"

await sendPushToOrganization(orgId, {
  title: "Mantenimiento programado",
  body: "El sistema estará offline el sábado de 02:00 a 04:00.",
  tag: "maintenance",
  requireInteraction: true,
})
```

### Payload shape

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Notification title. |
| `body` | yes | Notification body. |
| `path` | no | SPA path (e.g. `/ordenes/abc`) — receiver navigates here on tap. |
| `icon`, `badge`, `image` | no | URLs. Default icon: `/icon-192.png`. |
| `tag` | no | Web Push dedupe key + FCM data hint. |
| `requireInteraction` | no | Web Push only. |
| `silent` | no | Disables vibrate/sound. |
| `actions[]` | no | Up to 2 web-push action buttons `{action, title, icon?}`. |
| `data` | no | Extra k/v forwarded to the SW under `event.notification.data`. |

---

## 6. Client-side behavior

### Web (PWA / browser)

- `hooks/use-web-push.ts` exposes `{ supported, permission, subscribed, subscribe(), unsubscribe() }`.
- User-gesture required to call `subscribe()` (browser policy). The UI for that lives at `/perfil` → tab **Notificaciones**.
- Service worker (`public/sw.js`) handles `push` and `notificationclick`:
  - Tap a notification → focus an existing same-origin window and navigate to `data.path`, or open a new window.
  - When the SW can't directly navigate, it `postMessage`s `PUSH_NAVIGATE` and the hook routes via Next router.

### Native (Capacitor Android)

- `hooks/use-push-notifications.ts` calls `PushNotifications.register()` on every session restore. Token is POSTed to `/api/push-token` and stored in `push_tokens` with `platform="android"`.
- `pushNotificationActionPerformed` listener reads `notification.data.path` and `router.push()`es.

---

## 7. Testing

1. `/perfil` → Notificaciones → **Activar**.
2. Click **Probar**. This calls `POST /api/push/test` → `sendPushToUser(self, ...)`.
3. Verify the OS notification appears and tapping it navigates to `/dashboard`.

For end-to-end FCM testing in a Capacitor build:

```bash
npm run cap:sync
npm run cap:build:apk
adb install android/app/build/outputs/apk/debug/app-debug.apk
adb logcat | grep -i firebase
```

---

## 8. Failure handling

`sendPushToUser` automatically:

- Marks `web_push_subscriptions` inactive when the push service returns `404` or `410` (gone).
- Increments `failure_count` and deactivates the row after **5** cumulative failures.
- Marks `push_tokens` inactive when FCM returns `messaging/registration-token-not-registered` or `messaging/invalid-registration-token`.

`failure_count` resets on every successful send.

---

## 9. Env-var checklist

| Variable | Scope | Required for |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | client + server | Web Push |
| `VAPID_PUBLIC_KEY` | server | Web Push (signing) |
| `VAPID_PRIVATE_KEY` | server | Web Push (signing) |
| `VAPID_SUBJECT` | server | Web Push (RFC 8292 contact) |
| `FCM_SERVICE_ACCOUNT` | server | FCM / native push |

Without those, the relevant transport is silently skipped (returned `skipped` count in `SendResult`).
