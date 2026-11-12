import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { LabelTemplatesManager } from "@/components/configuracion/label-templates-manager"
import { PageShell } from "@/components/ui/page-shell"

export default async function LabelTemplatesPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }
  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  return (
    <PageShell
      title="Etiquetas térmicas"
      description={
        <>
          Plantillas ZPL/EPL para impresoras Zebra. El template usa placeholders{" "}
          <code className="font-mono text-[12px]">{"{{codigo}}"}</code>,{" "}
          <code className="font-mono text-[12px]">{"{{nombre}}"}</code>,{" "}
          <code className="font-mono text-[12px]">{"{{barcode}}"}</code>,{" "}
          <code className="font-mono text-[12px]">{"{{precio}}"}</code>,{" "}
          <code className="font-mono text-[12px]">{"{{org_nombre}}"}</code>.
        </>
      }
      backHref="/configuracion"
      backLabel="Volver a configuración"
    >
      <LabelTemplatesManager />
    </PageShell>
  )
}
