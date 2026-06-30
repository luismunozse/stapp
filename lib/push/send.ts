import { supabaseAdmin } from "@/lib/supabase"

/**
 * Push dispatcher — fans out a single payload to every active token a user
 * has across both transports:
 *   • Web Push (PushSubscription rows in `web_push_subscriptions`).
 *   • FCM / native (token rows in `push_tokens`).
 *
 * Both transports are wired behind dynamic imports so the server can boot
 * without the optional `web-push` / `firebase-admin` packages installed.
 * If a transport is unavailable, sends for that transport are skipped and
 * the failure is recorded once per-call in console.
 *
 * Required env vars (all optional — missing one disables that transport):
 *   VAPID_PUBLIC_KEY        (same value as NEXT_PUBLIC_VAPID_PUBLIC_KEY)
 *   VAPID_PRIVATE_KEY       (Base64URL)
 *   VAPID_SUBJECT           e.g. "mailto:soporte@stapp.com.ar"
 *   FCM_SERVICE_ACCOUNT     full Firebase service account JSON (one line)
 *                           or set FIREBASE_PROJECT_ID + FCM_SERVER_KEY for
 *                           legacy HTTP v1 / legacy server-key fallback.
 */

export interface PushPayload {
  title: string
  body: string
  /** SPA path or absolute URL — receiver navigates here on tap. */
  path?: string
  icon?: string
  badge?: string
  image?: string
  /** Group/dedupe key on the client. */
  tag?: string
  /** Defer dismissal until user interacts. */
  requireInteraction?: boolean
  silent?: boolean
  /** Up to 2 action buttons (web push only). */
  actions?: Array<{ action: string; title: string; icon?: string }>
  /** Extra data forwarded to the client; merged under `data` on the SW side. */
  data?: Record<string, unknown>
}

export interface SendResult {
  sent: number
  failed: number
  skipped: number
  byTransport: { web: number; fcm: number }
  errors: string[]
}

interface WebPushModule {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string
  ) => Promise<unknown>
}

let webPushModule: WebPushModule | null = null
let webPushInitialized = false

async function getWebPush(): Promise<WebPushModule | null> {
  if (webPushInitialized) return webPushModule
  webPushInitialized = true

  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("web-push" as any)
    const wp: WebPushModule = mod.default || mod
    wp.setVapidDetails(subject, publicKey, privateKey)
    webPushModule = wp
    return wp
  } catch {
    return null
  }
}

interface FcmSender {
  send: (token: string, payload: PushPayload) => Promise<void>
}

let fcmSender: FcmSender | null = null
let fcmInitialized = false

async function getFcm(): Promise<FcmSender | null> {
  if (fcmInitialized) return fcmSender
  fcmInitialized = true

  const sa = process.env.FCM_SERVICE_ACCOUNT
  if (!sa) return null

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("firebase-admin" as any)
    // Interop CJS/ESM: según el runtime los exports caen bajo `.default`.
    // Mismo patrón que getWebPush() más arriba.
    const admin = mod.default || mod
    if (!admin.apps?.length) {
      const cred = JSON.parse(sa)
      admin.initializeApp({ credential: admin.credential.cert(cred) })
    }
    fcmSender = {
      async send(token: string, payload: PushPayload) {
        await admin.messaging().send({
          token,
          notification: { title: payload.title, body: payload.body },
          data: {
            // FCM data values must be strings.
            ...(payload.path ? { path: payload.path } : {}),
            ...(payload.tag ? { tag: payload.tag } : {}),
            ...(payload.data
              ? Object.fromEntries(
                  Object.entries(payload.data).map(([k, v]) => [k, String(v)])
                )
              : {}),
          },
          android: {
            priority: payload.silent ? "normal" : "high",
            notification: {
              icon: payload.icon,
              sound: payload.silent ? undefined : "default",
            },
          },
        })
      },
    }
    return fcmSender
  } catch {
    return null
  }
}

/**
 * Dispatch `payload` to every active subscription/token belonging to `userId`.
 * Marks subscriptions inactive after repeated failures (>= 5 cumulative).
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<SendResult> {
  const result: SendResult = {
    sent: 0,
    failed: 0,
    skipped: 0,
    byTransport: { web: 0, fcm: 0 },
    errors: [],
  }

  const [webRes, fcmRes] = await Promise.all([
    supabaseAdmin
      .from("web_push_subscriptions")
      .select("id, endpoint, p256dh, auth, failure_count")
      .eq("user_id", userId)
      .eq("active", true),
    supabaseAdmin
      .from("push_tokens")
      .select("id, token, platform")
      .eq("user_id", userId)
      .eq("active", true),
  ])

  const webSubs = webRes.data ?? []
  const fcmTokens = fcmRes.data ?? []

  if (webSubs.length === 0 && fcmTokens.length === 0) {
    return result
  }

  // -----------------------------------------------------------------
  // Web Push
  // -----------------------------------------------------------------
  if (webSubs.length > 0) {
    const wp = await getWebPush()
    if (!wp) {
      result.skipped += webSubs.length
      result.errors.push("web-push no configurado (VAPID_* env vars o paquete faltante)")
    } else {
      const payloadStr = JSON.stringify(payload)
      await Promise.all(
        webSubs.map(async (sub) => {
          try {
            await wp.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payloadStr
            )
            result.sent++
            result.byTransport.web++
            await supabaseAdmin
              .from("web_push_subscriptions")
              .update({ failure_count: 0, last_used_at: new Date().toISOString() })
              .eq("id", sub.id)
          } catch (err) {
            result.failed++
            const code = (err as { statusCode?: number })?.statusCode
            const newCount = (sub.failure_count || 0) + 1
            const shouldDeactivate = code === 404 || code === 410 || newCount >= 5
            await supabaseAdmin
              .from("web_push_subscriptions")
              .update({
                failure_count: newCount,
                active: !shouldDeactivate,
                updated_at: new Date().toISOString(),
              })
              .eq("id", sub.id)
            result.errors.push(`web-push ${code ?? "err"}: ${(err as Error).message}`)
          }
        })
      )
    }
  }

  // -----------------------------------------------------------------
  // FCM (Capacitor / native)
  // -----------------------------------------------------------------
  if (fcmTokens.length > 0) {
    const fcm = await getFcm()
    if (!fcm) {
      result.skipped += fcmTokens.length
      result.errors.push("fcm no configurado (FCM_SERVICE_ACCOUNT env o paquete faltante)")
    } else {
      await Promise.all(
        fcmTokens.map(async (t) => {
          try {
            await fcm.send(t.token, payload)
            result.sent++
            result.byTransport.fcm++
          } catch (err) {
            result.failed++
            const code = (err as { code?: string })?.code
            const dead =
              code === "messaging/registration-token-not-registered" ||
              code === "messaging/invalid-registration-token"
            if (dead) {
              await supabaseAdmin
                .from("push_tokens")
                .update({ active: false })
                .eq("id", t.id)
            }
            result.errors.push(`fcm ${code ?? "err"}: ${(err as Error).message}`)
          }
        })
      )
    }
  }

  return result
}

/** Convenience helper: dispatch to multiple users in parallel. */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<SendResult> {
  const results = await Promise.all(userIds.map((id) => sendPushToUser(id, payload)))
  return results.reduce<SendResult>(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      failed: acc.failed + r.failed,
      skipped: acc.skipped + r.skipped,
      byTransport: {
        web: acc.byTransport.web + r.byTransport.web,
        fcm: acc.byTransport.fcm + r.byTransport.fcm,
      },
      errors: [...acc.errors, ...r.errors],
    }),
    { sent: 0, failed: 0, skipped: 0, byTransport: { web: 0, fcm: 0 }, errors: [] }
  )
}

/** Dispatch to all active members of an org. Used for broadcasts. */
export async function sendPushToOrganization(
  organizationId: string,
  payload: PushPayload
): Promise<SendResult> {
  const [{ data: webUsers }, { data: fcmUsers }] = await Promise.all([
    supabaseAdmin
      .from("web_push_subscriptions")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("active", true),
    supabaseAdmin
      .from("push_tokens")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("active", true),
  ])
  const userIds = Array.from(
    new Set([
      ...(webUsers ?? []).map((r: { user_id: string }) => r.user_id),
      ...(fcmUsers ?? []).map((r: { user_id: string }) => r.user_id),
    ])
  )
  return sendPushToUsers(userIds, payload)
}
