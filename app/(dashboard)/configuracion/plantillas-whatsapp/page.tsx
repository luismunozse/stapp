import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { PlantillasWhatsappEditor } from "@/components/configuracion/plantillas-whatsapp-editor"
import { PageShell } from "@/components/ui/page-shell"

export default async function PlantillasWhatsappPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  return (
    <PageShell
      title="Plantillas de WhatsApp"
      description={
        <>
          Personalizá los mensajes predeterminados que envía el sistema por WhatsApp. Usá variables entre llaves como{" "}
          <code className="text-xs">{"{cliente}"}</code> para insertar datos dinámicos.
        </>
      }
      backHref="/configuracion"
      backLabel="Volver a configuración"
    >
      <PlantillasWhatsappEditor />
    </PageShell>
  )
}
