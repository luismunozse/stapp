import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { PlantillasWhatsappEditor } from "@/components/configuracion/plantillas-whatsapp-editor"

export default async function PlantillasWhatsappPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Plantillas de WhatsApp</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Personalizá los mensajes predeterminados que envía el sistema por WhatsApp. Usá variables entre llaves como{" "}
          <code className="text-xs">{"{cliente}"}</code> para insertar datos dinámicos.
        </p>
      </div>

      <PlantillasWhatsappEditor />
    </div>
  )
}
