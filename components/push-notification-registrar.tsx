"use client"

import { usePushNotifications } from "@/hooks/use-push-notifications"
import { useWebPush } from "@/hooks/use-web-push"

export function PushNotificationRegistrar() {
  // Native: auto-registers FCM token on first session.
  usePushNotifications()
  // Web: probes permission state + listens for SW PUSH_NAVIGATE messages.
  // Actual subscribe() runs only from the settings UI (user-gesture required).
  useWebPush()
  return null
}
