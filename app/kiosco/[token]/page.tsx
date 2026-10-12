import type { Metadata } from "next"
import { KioskDisplay } from "@/components/kiosco/kiosk-display"

export const metadata: Metadata = {
  title: "Modo Kiosco - STApp",
  // Token-addressed screen: keep it out of the index. No robots.txt
  // disallow on purpose — a blocked page is never crawled, so this
  // noindex would never be read.
  robots: { index: false, follow: false },
}

export default async function KioskPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return <KioskDisplay token={token} />
}
