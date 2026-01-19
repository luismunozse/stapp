"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  LogoWrenchCircuit,
  LogoMonogramST,
  LogoDeviceCheck,
  LogoToolsAbstract,
  LogoHexagonTech,
  LogoBolt,
  LogoGear,
  LogoShield,
} from "@/components/shared/logo-alternatives"
import { Check, Moon, Sun } from "lucide-react"

const logos = [
  {
    id: "wrench-circuit",
    name: "Wrench + Circuit",
    desc: "Herramienta de reparación combinada con líneas de circuito. Representa la fusión entre lo técnico y lo digital.",
    component: LogoWrenchCircuit,
  },
  {
    id: "monogram-st",
    name: "Monograma ST",
    desc: "Iniciales ST en un cuadrado redondeado. Limpio, moderno y fácil de reconocer en cualquier tamaño.",
    component: LogoMonogramST,
  },
  {
    id: "device-check",
    name: "Device + Check",
    desc: "Teléfono con checkmark de completado. Comunica directamente el servicio: reparación de dispositivos.",
    component: LogoDeviceCheck,
  },
  {
    id: "tools-abstract",
    name: "Tools Abstract",
    desc: "Destornillador y llave en forma abstracta. Profesional y técnico sin ser literal.",
    component: LogoToolsAbstract,
  },
  {
    id: "hexagon-tech",
    name: "Hexagon Tech",
    desc: "Hexágono con ST integrado. Forma geométrica asociada a tecnología e innovación.",
    component: LogoHexagonTech,
  },
  {
    id: "bolt",
    name: "Bolt / Lightning",
    desc: "Rayo en círculo. Transmite velocidad, energía y servicio rápido.",
    component: LogoBolt,
  },
  {
    id: "gear",
    name: "Gear / Engranaje",
    desc: "Engranaje minimalista. Clásico símbolo de servicio técnico y mecánica.",
    component: LogoGear,
  },
  {
    id: "shield",
    name: "Shield Pro",
    desc: "Escudo con checkmark. Transmite confianza, garantía y protección.",
    component: LogoShield,
  },
]

export default function LogoPreviewPage() {
  const [selectedLogo, setSelectedLogo] = useState<string | null>(null)
  const [previewDark, setPreviewDark] = useState(false)

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Alternativas de Logo</h1>
        <p className="text-muted-foreground">
          Selecciona el logo que mejor represente a STApp. Cada opción está diseñada para funcionar en diferentes tamaños y fondos.
        </p>
      </div>

      {/* Preview mode toggle */}
      <div className="flex items-center gap-4 mb-6">
        <span className="text-sm text-muted-foreground">Vista previa:</span>
        <div className="inline-flex rounded-lg border border-input p-1 bg-muted/50">
          <button
            type="button"
            onClick={() => setPreviewDark(false)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              !previewDark
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sun className="h-4 w-4" />
            Claro
          </button>
          <button
            type="button"
            onClick={() => setPreviewDark(true)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              previewDark
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Moon className="h-4 w-4" />
            Oscuro
          </button>
        </div>
      </div>

      {/* Logo grid */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {logos.map(({ id, name, desc, component: Logo }) => (
          <Card
            key={id}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md",
              selectedLogo === id && "ring-2 ring-primary"
            )}
            onClick={() => setSelectedLogo(id)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{name}</CardTitle>
                  <CardDescription className="text-sm mt-1">{desc}</CardDescription>
                </div>
                {selectedLogo === id && (
                  <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-4 w-4 text-white" />
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* Preview area */}
              <div
                className={cn(
                  "rounded-lg p-6 transition-colors",
                  previewDark ? "bg-slate-900" : "bg-muted/50"
                )}
              >
                <div className="flex flex-wrap items-center gap-6">
                  {/* Icon only */}
                  <div className="text-center">
                    <Logo
                      size="lg"
                      variant="icon"
                      className={previewDark ? "[&_text]:fill-white" : ""}
                    />
                    <span
                      className={cn(
                        "text-xs block mt-2",
                        previewDark ? "text-slate-400" : "text-muted-foreground"
                      )}
                    >
                      Icono
                    </span>
                  </div>

                  {/* Full logo */}
                  <div className="space-y-3">
                    <Logo
                      size="sm"
                      variant="full"
                      className={previewDark ? "[&_span]:text-white" : ""}
                    />
                    <Logo
                      size="md"
                      variant="full"
                      className={previewDark ? "[&_span]:text-white" : ""}
                    />
                    <Logo
                      size="lg"
                      variant="full"
                      className={previewDark ? "[&_span]:text-white" : ""}
                    />
                  </div>
                </div>
              </div>

              {/* Use cases preview */}
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="text-xs px-2 py-1 bg-muted rounded">Navbar</span>
                <span className="text-xs px-2 py-1 bg-muted rounded">Favicon</span>
                <span className="text-xs px-2 py-1 bg-muted rounded">Login</span>
                <span className="text-xs px-2 py-1 bg-muted rounded">Email</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Selected logo preview in context */}
      {selectedLogo && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Vista previa en contexto</CardTitle>
            <CardDescription>
              Así se vería el logo seleccionado en diferentes partes de la aplicación
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Navbar simulation */}
            <div>
              <span className="text-sm text-muted-foreground mb-2 block">Barra de navegación:</span>
              <div className="border rounded-lg p-4 bg-background flex items-center gap-4">
                {(() => {
                  const Logo = logos.find((l) => l.id === selectedLogo)?.component
                  return Logo ? <Logo size="md" variant="full" /> : null
                })()}
                <div className="flex-1" />
                <span className="text-sm text-muted-foreground">Dashboard</span>
                <span className="text-sm text-muted-foreground">Órdenes</span>
                <span className="text-sm text-muted-foreground">Clientes</span>
              </div>
            </div>

            {/* Login page simulation */}
            <div>
              <span className="text-sm text-muted-foreground mb-2 block">Página de login:</span>
              <div className="border rounded-lg p-8 bg-muted/30 flex flex-col items-center">
                {(() => {
                  const Logo = logos.find((l) => l.id === selectedLogo)?.component
                  return Logo ? <Logo size="xl" variant="full" /> : null
                })()}
                <div className="w-full max-w-xs mt-6 space-y-3">
                  <div className="h-10 bg-background border rounded-md" />
                  <div className="h-10 bg-background border rounded-md" />
                  <div className="h-10 bg-primary rounded-md" />
                </div>
              </div>
            </div>

            {/* Favicon preview */}
            <div>
              <span className="text-sm text-muted-foreground mb-2 block">Favicon / App icon:</span>
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded bg-white dark:bg-slate-100 border shadow-sm flex items-center justify-center overflow-hidden">
                  {(() => {
                    const Logo = logos.find((l) => l.id === selectedLogo)?.component
                    return Logo ? <Logo size="sm" variant="icon" /> : null
                  })()}
                </div>
                <div className="w-12 h-12 rounded-lg bg-white dark:bg-slate-100 border shadow-sm flex items-center justify-center overflow-hidden">
                  {(() => {
                    const Logo = logos.find((l) => l.id === selectedLogo)?.component
                    return Logo ? <Logo size="md" variant="icon" /> : null
                  })()}
                </div>
                <div className="w-16 h-16 rounded-xl bg-white dark:bg-slate-100 border shadow-sm flex items-center justify-center overflow-hidden">
                  {(() => {
                    const Logo = logos.find((l) => l.id === selectedLogo)?.component
                    return Logo ? <Logo size="lg" variant="icon" /> : null
                  })()}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-4">
        <Button variant="outline" onClick={() => setSelectedLogo(null)}>
          Limpiar selección
        </Button>
        <Button disabled={!selectedLogo}>
          Usar este logo
        </Button>
      </div>
    </div>
  )
}
