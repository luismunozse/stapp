"use client"

import { usePushNotifications } from "@/hooks/use-push-notifications"

export function PushNotificationRegistrar() {
  usePushNotifications()
  return null
}
