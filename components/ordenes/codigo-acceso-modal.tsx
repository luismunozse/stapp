"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { PatternLock } from "@/components/ui/pattern-lock"
import { Hash, KeyRound, Grid3X3, Eye, EyeOff } from "lucide-react"

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Código de acceso</DialogTitle>
          <DialogDescription>Solo si es necesario para realizar pruebas</DialogDescription>
        </DialogHeader>

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
              patron. */}
          <div className="min-h-[240px] flex flex-col justify-center">
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
                autoFocus
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
                  autoFocus
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
              <PatternLock value={draft} onChange={setDraft} />
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={guardar}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
