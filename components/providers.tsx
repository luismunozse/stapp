"use client"

import { SessionProvider } from "next-auth/react"
import { ModalProvider } from "@/contexts/modal-context"
import { ConfirmProvider } from "@/contexts/confirm-context"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ConfirmProvider>
        <ModalProvider>{children}</ModalProvider>
      </ConfirmProvider>
    </SessionProvider>
  )
}
