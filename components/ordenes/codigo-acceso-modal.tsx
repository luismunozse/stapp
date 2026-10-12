"use client"

import { useEffect, useState } from "react"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { PatternLock } from "@/components/ui/pattern-lock"
import { Hash, KeyRound, Grid3X3, Eye, EyeOff } from "lucide-react"
import { useIsMobileViewport } from "@/hooks/use-is-mobile-viewport"

export type TipoCodigoAcceso = "codigo" | "contrasena" | "patron"

/**
 * Infiere la pestana activa a partir del valor guardado. El prefijo
 * "Patrón: " es el contrato de persistencia que emite PatternLock (no se
 * toca); un valor todo digitos es un codigo numerico; cualquier otro texto
 * no vacio es una contrasena. Vacio arranca en "codigo" por ser la opcion
 * mas comun en mostrador.
 */
export function inferirTipoAcceso(value: string): TipoCodigoAcceso {
  if (value.startsWith("Patrón: ")) return "patron"
  if (value !== "" && !/^\d+$/.test(value)) return "contrasena"
  return "codigo"
}

interface CodigoAccesoModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (value: string) => void
}

/**
 * Editor de codigo/contrasena/patron de acceso de un equipo, usado en la
 * recepcion multiple (ver RecepcionEquipoCard). Mantiene un borrador interno:
 * el valor real (`onChange`) recien se actualiza al confirmar "Guardar" --
 * "Cancelar" o cerrar el dialogo por cualquier otro medio (X, click afuera,
 * Escape) descartan lo escrito, porque todos esos caminos pasan por el mismo
 * `onOpenChange` sin tocar `onChange`.
 */
export function CodigoAccesoModal({ open, onOpenChange, value, onChange }: CodigoAccesoModalProps) {
  const [tab, setTab] = useState<TipoCodigoAcceso>(() => inferirTipoAcceso(value))
  const [draft, setDraft] = useState(value)
  const [mostrarContrasena, setMostrarContrasena] = useState(false)
  // Gatea autoFocus: en mobile la hoja queda anclada al fondo y el proyecto
  // no maneja visualViewport/keyboard-avoidance (ni dvh se achica con el
  // teclado en varios WebView de Android/PWA instalada), asi que un input
  // autofocado puede terminar renderizado debajo del teclado. En desktop no
  // hay teclado tactil que lo tape, asi que ahi si autofocamos como siempre.
  const isMobile = useIsMobileViewport()

  // Solo debe resincronizar el borrador en la transicion cerrado -> abierto,
  // no en cada render mientras esta abierto (onChange solo se dispara al
  // guardar, asi que `value` no deberia cambiar por debajo mientras tanto,
  // pero de todos modos no queremos que un re-render del padre pise lo que
  // el mostrador esta escribiendo).
  useEffect(() => {
    if (!open) return
    setDraft(value)
    setTab(inferirTipoAcceso(value))
    setMostrarContrasena(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Cambiar de pestana limpia el borrador -- mismo criterio que el toggle
  // PIN/Patron de orden-form.tsx: cada pestana es un formato de dato
  // distinto, mezclar lo que se escribio en una con otra no tiene sentido.
  const cambiarTab = (nuevaTab: string) => {
    if (nuevaTab === tab) return
    setTab(nuevaTab as TipoCodigoAcceso)
    setDraft("")
  }

  const guardar = () => {
    onChange(draft)
    onOpenChange(false)
  }

  return (
    // Bottom-sheet en mobile / dialogo centrado en desktop: usa el primitivo
    // compartido ResponsiveDialog (components/ui/responsive-dialog.tsx), ya
    // usado por ConfirmarReparadoDialog, CobrarOrdenDialog,
    // PosCheckoutDialog y PosDevolucionSearch -- mismo grab handle,
    // reduced-motion y estrategia de safe-area/max-height que esos cuatro,
    // en vez de reimplementar el mismo patron a mano con overrides max-sm:
    // sobre <Dialog>. sm:max-w-sm preserva el ancho de desktop de siempre
    // (Dialog base trae sm:max-w-lg).
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Código de acceso</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Solo si es necesario para realizar pruebas</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <Tabs value={tab} onValueChange={cambiarTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="codigo">
              <Hash className="h-4 w-4 mr-1.5" />
              Código
            </TabsTrigger>
            <TabsTrigger value="contrasena">
              <KeyRound className="h-4 w-4 mr-1.5" />
              Contraseña
            </TabsTrigger>
            <TabsTrigger value="patron">
              <Grid3X3 className="h-4 w-4 mr-1.5" />
              Patrón
            </TabsTrigger>
          </TabsList>

          {/* Alto minimo compartido por las tres pestanas para que el
              dialogo no salte al cambiar entre el input y el canvas del
              patron. Deliberadamente el mismo en mobile y desktop: PatternLock
              se renderiza a 240px en las dos (mas abajo), no solo en mobile,
              asi que un unico valor alcanza -- 240px de canvas + ~8px de gap
              + ~24px de la fila de estado/Limpiar debajo. */}
          <div className="min-h-[280px] flex flex-col justify-center">
            <TabsContent value="codigo" className="mt-4">
              <Label htmlFor="codigo-acceso-input">Código numérico</Label>
              <Input
                id="codigo-acceso-input"
                inputMode="numeric"
                autoComplete="off"
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
                placeholder="Ej: 1234"
                className="mt-2 h-14 text-center text-2xl tracking-[0.3em]"
                autoFocus={!isMobile}
              />
            </TabsContent>

            <TabsContent value="contrasena" className="mt-4">
              <Label htmlFor="contrasena-acceso-input">Contraseña</Label>
              <div className="relative mt-2">
                <Input
                  id="contrasena-acceso-input"
                  type={mostrarContrasena ? "text" : "password"}
                  autoComplete="off"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Contraseña para pruebas"
                  className="h-14 pr-10 text-lg"
                  autoFocus={!isMobile}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-14 px-3 hover:bg-transparent"
                  onClick={() => setMostrarContrasena((prev) => !prev)}
                  aria-label={mostrarContrasena ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {mostrarContrasena ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="patron" className="mt-4 flex justify-center">
              {/* 240px en vez del default (180): 180 es finger-hostile para
                  dibujar el patron con el dedo en mostrador. getEventPosition
                  en pattern-lock.tsx ya rescala por getBoundingClientRect, asi
                  que este tamano funciona igual en mobile y desktop sin tocar
                  ese componente. */}
              <PatternLock value={draft} onChange={setDraft} size={240} />
            </TabsContent>
          </div>
        </Tabs>

        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={guardar}>
            Guardar
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
