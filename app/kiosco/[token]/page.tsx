import { KioskDisplay } from "@/components/kiosco/kiosk-display"

export const metadata = {
  title: "Modo Kiosco - STApp",
}

export default async function KioskPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return <KioskDisplay token={token} />
}
