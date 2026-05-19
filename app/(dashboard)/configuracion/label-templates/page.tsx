import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { LabelTemplatesManager } from "@/components/configuracion/label-templates-manager"

export default async function LabelTemplatesPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }
  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <Link
          href="/configuracion"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Volver a Configuración
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold">Etiquetas térmicas</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Plantillas ZPL/EPL para impresoras Zebra. El template usa placeholders{" "}
          <code className="font-mono text-[12px]">{"{{codigo}}"}</code>,{" "}
          <code className="font-mono text-[12px]">{"{{nombre}}"}</code>,{" "}
          <code className="font-mono text-[12px]">{"{{barcode}}"}</code>,{" "}
          <code className="font-mono text-[12px]">{"{{precio}}"}</code>,{" "}
          <code className="font-mono text-[12px]">{"{{org_nombre}}"}</code>.
        </p>
      </div>
      <LabelTemplatesManager />
    </div>
  )
}
