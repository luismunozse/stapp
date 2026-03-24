"use client"

import { SessionProvider } from "next-auth/react"
import { ModalProvider } from "@/contexts/modal-context"
import { ConfirmProvider } from "@/contexts/confirm-context"
import { SessionRefresher } from "@/components/auth/session-refresher"
import { CurrencyProvider } from "@/contexts/currency-context"
import { PushNotificationRegistrar } from "@/components/push-notification-registrar"
import { Toaster } from "sonner"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      <SessionRefresher>
        <CurrencyProvider>
          <ConfirmProvider>
            <ModalProvider>
              {children}
              <PushNotificationRegistrar />
              <Toaster position="top-right" richColors closeButton />
            </ModalProvider>
          </ConfirmProvider>
        </CurrencyProvider>
      </SessionRefresher>
    </SessionProvider>
  )
}
