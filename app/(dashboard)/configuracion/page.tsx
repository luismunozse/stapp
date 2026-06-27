import type { ComponentType } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ConfiguracionForm } from "@/components/configuracion/configuracion-form"
import { Card, CardContent } from "@/components/ui/card"
import { CookieSettings } from "@/components/cookie-settings"
import Link from "next/link"
import {
  ClipboardCheck,
  ChevronRight,
  CreditCard,
  FileSpreadsheet,
  Percent,
  Smartphone,
  Monitor,
  Tag,
  Repeat,
  Warehouse,
  Printer,
  Store,
  Type,
  type LucideIcon,
} from "lucide-react"
import { canEditConfiguration } from "@/lib/auth-utils"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { SecuritySettings } from "@/components/configuracion/security-settings"
import { supabaseAdmin } from "@/lib/supabase"
import { PageShell } from "@/components/ui/page-shell"

type SettingCard = {
  href: string
  icon: LucideIcon | ComponentType<{ className?: string }>
  label: string
  labelShort?: string
  desc: string
  descShort?: string
}

type SettingSection = {
  title: string
  /** Full Tailwind classes (kept literal so the JIT compiler can detect them). */
  accent: string
  cards: SettingCard[]
}

// Agrupado por modelo mental del dueño del taller. Webhooks y API Keys quedan
// fuera (features de integración para devs, sin clientes activos); sus rutas
// siguen vivas en /configuracion/webhooks y /configuracion/api-keys.
const SECTIONS: SettingSection[] = [
  {
    title: "Operación",
    accent: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    cards: [
      {
        href: "/configuracion/checklist",
        icon: ClipboardCheck,
        label: "Checklist",
        desc: "Items del checklist de ingreso",
        descShort: "Checklist de ingreso",
      },
      {
        href: "/configuracion/tipos-dispositivo",
        icon: Smartphone,
        label: "Tipos de Dispositivo",
        labelShort: "Dispositivos",
        desc: "Gestioná los tipos de dispositivo",
        descShort: "Tipos disponibles",
      },
      {
        href: "/configuracion/label-templates",
        icon: Printer,
        label: "Etiquetas térmicas",
        labelShort: "Etiquetas",
        desc: "Plantillas ZPL/EPL para Zebra",
        descShort: "ZPL / EPL",
      },
      {
        href: "/configuracion/kiosco",
        icon: Monitor,
        label: "Modo Kiosco",
        labelShort: "Kiosco",
        desc: "Pantallas de estado para tu local",
        descShort: "Pantallas",
      },
      {
        href: "/configuracion/vocabulario",
        icon: Type,
        label: "Vocabulario",
        labelShort: "Vocabulario",
        desc: "Personalizá los términos según tu rubro",
        descShort: "Términos por rubro",
      },
    ],
  },
  {
    title: "Finanzas",
    accent: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    cards: [
      {
        href: "/configuracion/billing",
        icon: CreditCard,
        label: "Facturación y Plan",
        labelShort: "Facturación",
        desc: "Gestioná tu suscripción y pagos",
        descShort: "Plan y pagos",
      },
      {
        href: "/configuracion/categorias-gasto",
        icon: Tag,
        label: "Categorías de Gasto",
        labelShort: "Categorías",
        desc: "Clasificá tus gastos para el cálculo de ganancia",
        descShort: "Clasificación de gastos",
      },
      {
        href: "/configuracion/gastos-recurrentes",
        icon: Repeat,
        label: "Gastos Recurrentes",
        labelShort: "Recurrentes",
        desc: "Alquiler, sueldos y otros gastos fijos",
        descShort: "Alquiler, sueldos, etc",
      },
      {
        href: "/configuracion/recargos-metodo",
        icon: Percent,
        label: "Recargos por método de pago",
        labelShort: "Recargos",
        desc: "Precio según el método de pago del cliente",
        descShort: "Precio por método",
      },
    ],
  },
  {
    title: "Comunicación",
    accent: "bg-green-500/10 text-green-600 dark:text-green-400",
    cards: [
      {
        href: "/configuracion/whatsapp",
        icon: WhatsAppIcon,
        label: "WhatsApp Business",
        labelShort: "WhatsApp",
        desc: "Notificaciones vía WhatsApp API",
        descShort: "API WhatsApp",
      },
      {
        href: "/configuracion/plantillas-whatsapp",
        icon: WhatsAppIcon,
        label: "Plantillas WhatsApp",
        labelShort: "Plantillas",
        desc: "Personalizá los mensajes por tipo",
        descShort: "Mensajes predeterminados",
      },
    ],
  },
  {
    title: "Sucursales y stock",
    accent: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    cards: [
      {
        href: "/configuracion/sucursales",
        icon: Store,
        label: "Sucursales",
        desc: "Locales físicos: órdenes, ventas y caja por sucursal",
        descShort: "Locales / personal",
      },
      {
        href: "/configuracion/depositos",
        icon: Warehouse,
        label: "Depósitos",
        desc: "Sucursales y transferencias de stock",
        descShort: "Sucursales / stock",
      },
    ],
  },
  {
    title: "Datos",
    accent: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    cards: [
      {
        href: "/configuracion/importaciones",
        icon: FileSpreadsheet,
        label: "Importaciones",
        desc: "Historial de importaciones CSV/Excel",
        descShort: "Historial CSV",
      },
    ],
  },
]

export default async function ConfiguracionPage() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  if (session.user?.role !== "ADMIN") {
    redirect("/dashboard")
  }

  const allowEdit = await canEditConfiguration()

  // Obtener estado de 2FA del usuario
  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("totp_enabled")
    .eq("id", session.user.id)
    .single()

  const totpEnabled = userData?.totp_enabled || false

  return (
    <PageShell
      title="Configuración"
      description="Ajustes de tu taller: operación, finanzas, comunicación y sucursales"
    >
      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.title} className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {section.title}
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {section.cards.map((card) => {
                const Icon = card.icon
                return (
                  <Link key={card.href} href={card.href} className="group block">
                    <Card className="h-full transition-[transform,border-color,box-shadow] duration-200 ease-out hover:border-foreground/20 hover:shadow-sm active:scale-[0.98]">
                      <CardContent className="flex items-start gap-3 p-3 sm:p-4">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${section.accent}`}
                        >
                          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-1">
                            <span className="truncate text-xs font-medium sm:text-sm">
                              <span className="hidden sm:inline">{card.label}</span>
                              <span className="sm:hidden">
                                {card.labelShort ?? card.label}
                              </span>
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground sm:text-xs">
                            <span className="hidden sm:inline">{card.desc}</span>
                            <span className="sm:hidden">
                              {card.descShort ?? card.desc}
                            </span>
                          </span>
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Seguridad - 2FA */}
      <SecuritySettings totpEnabled={totpEnabled} />

      {!allowEdit && (
        <div className="bg-yellow-50 dark:bg-yellow-950/50 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300 px-4 py-3 rounded-lg">
          <p className="text-sm font-medium">Las cuentas demo no pueden editar la configuración</p>
        </div>
      )}

      <ConfiguracionForm allowEdit={allowEdit} />

      <CookieSettings />
    </PageShell>
  )
}
