"use client"

import { SessionProvider } from "next-auth/react"
import { ModalProvider } from "@/contexts/modal-context"
import { ConfirmProvider } from "@/contexts/confirm-context"
import { SessionRefresher } from "@/components/auth/session-refresher"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      <SessionRefresher>
        <ConfirmProvider>
          <ModalProvider>{children}</ModalProvider>
        </ConfirmProvider>
      </SessionRefresher>
    </SessionProvider>
  )
}
