import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { getLifecycleEmail, type LifecycleEmailType } from "@/lib/emails/lifecycle-templates"

const AVAILABLE_TYPES: { type: LifecycleEmailType; label: string; description: string }[] = [
  { type: "WELCOME", label: "Bienvenida", description: "Se envia 1 dia despues del registro" },
  { type: "TIP_DAY_3", label: "Tip dia 3", description: "Tips de WhatsApp, cotizaciones y tracking" },
  { type: "TIP_DAY_7", label: "Tip dia 7", description: "Inventario, ventas, garantias y reportes" },
  { type: "TRIAL_EXPIRING_5", label: "Trial -5 dias", description: "Alerta 5 dias antes de que venza el trial" },
  { type: "TRIAL_EXPIRING_1", label: "Trial -1 dia", description: "Ultimo dia de prueba, urgencia" },
  { type: "TRIAL_EXPIRED", label: "Trial expirado", description: "Prueba vencida, invita a suscribirse" },
  { type: "WIN_BACK_7", label: "Win-back 7 dias", description: "Org sin actividad hace 7 dias" },
  { type: "WIN_BACK_30", label: "Win-back 30 dias", description: "Org sin actividad hace 30 dias" },
  { type: "MILESTONE", label: "Milestone", description: "Hito alcanzado (50, 100, 250+ ordenes)" },
]

// GET - Lista de tipos disponibles
export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    return NextResponse.json({ types: AVAILABLE_TYPES })
  } catch (error) {
    console.error("Error:", error)
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}

// POST - Renderizar preview de un email
export async function POST(request: NextRequest) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const body = await request.json()
    const { type } = body as { type: LifecycleEmailType }

    if (!type) {
      return NextResponse.json({ error: "type es requerido" }, { status: 400 })
    }

    // Datos de ejemplo para el preview
    const sampleData = {
      nombre: "Juan Perez",
      organizacion: "TecnoFix Argentina",
      slug: "tecnofix",
      diasRestantes: 5,
      milestone: { tipo: "ordenes", valor: 100 },
    }

    const { subject, html } = getLifecycleEmail(type, sampleData)

    return NextResponse.json({ subject, html, type })
  } catch (error) {
    console.error("Error rendering preview:", error)
    return NextResponse.json({ error: "Error al renderizar preview" }, { status: 500 })
  }
}
