"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { AlertTriangle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { DeletionInfo } from "@/lib/account-deletion/types"
import { EliminarUsuarioDialog } from "./eliminar-usuario-dialog"
import { EliminarTallerDialog } from "./eliminar-taller-dialog"

export function ZonaDePeligro() {
  const { data: session } = useSession()
  // Las rutas de borrado responden 403 a superadmin y a sesiones impersonadas.
  const blocked = Boolean(session?.user?.isSuperadmin || session?.user?.isImpersonating)

  const [info, setInfo] = useState<DeletionInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [orgOpen, setOrgOpen] = useState(false)
  const orgButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (blocked) return
    let cancelled = false
    fetch("/api/account/deletion-info", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("deletion-info")
        const data = (await r.json()) as DeletionInfo | null
        if (!data || typeof data !== "object" || typeof data.role !== "string") throw new Error("deletion-info")
        return data
      })
      .then((data) => {
        if (!cancelled) setInfo(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [blocked])

  // Deep link de /legal/eliminar-cuenta: /perfil#eliminar. El ancla existe desde el
  // primer render, pero el layout cambia al cargar: reubicamos cuando llega la info.
  useEffect(() => {
    if ((info || failed) && typeof window !== "undefined" && window.location.hash === "#eliminar") {
      document.getElementById("eliminar")?.scrollIntoView?.({ behavior: "smooth", block: "start" })
    }
  }, [info, failed])

  if (blocked) return null

  const goToOrgDeletion = () => {
    const el = orgButtonRef.current
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" })
    el?.focus()
  }

  return (
    <Card id="eliminar" className="scroll-mt-20 border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Zona de peligro
        </CardTitle>
        <CardDescription>Acciones permanentes sobre tu cuenta.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!info && !failed && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {failed && (
          <p role="alert" className="text-sm text-muted-foreground">
            No pudimos cargar las opciones de eliminación. Recargá la página.
          </p>
        )}

        {info && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Eliminar mi usuario</p>
                <p className="text-sm text-muted-foreground">
                  Borra tus datos personales. Tus operaciones quedan en el taller como “Usuario eliminado”.
                </p>
                {info.isLastAdmin && (
                  <div className="space-y-2">
                    <p className="text-sm text-amber-600">
                      Sos el único administrador del taller. Para eliminar tu usuario, eliminá el taller o pasale el rol de
                      administrador a otra persona desde la gestión de usuarios.
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={goToOrgDeletion}>
                      Ir a la opción de borrar el taller
                    </Button>
                  </div>
                )}
              </div>
              <Button variant="destructive" disabled={info.isLastAdmin} onClick={() => setUserOpen(true)}>
                Eliminar mi usuario
              </Button>
            </div>

            {info.role === "ADMIN" && (
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Eliminar el taller</p>
                  <p className="text-sm text-muted-foreground">
                    Desactiva el acceso de todo el equipo, cancela la suscripción y borra los datos a los {info.graceDays} días.
                    Podés descargar un respaldo antes.
                  </p>
                </div>
                <Button ref={orgButtonRef} variant="destructive" onClick={() => setOrgOpen(true)}>
                  Eliminar el taller
                </Button>
              </div>
            )}

            <EliminarUsuarioDialog open={userOpen} onOpenChange={setUserOpen} info={info} />
            {info.role === "ADMIN" && <EliminarTallerDialog open={orgOpen} onOpenChange={setOrgOpen} info={info} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}
