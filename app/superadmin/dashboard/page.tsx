import { redirect } from "next/navigation"
import { getSuperadminSession } from "@/lib/superadmin-auth"
import { DashboardContent } from "./_components/dashboard-content"

export default async function SuperadminDashboard() {
  const session = await getSuperadminSession()
  if (!session) redirect("/superadmin-login")

  return <DashboardContent />
}
