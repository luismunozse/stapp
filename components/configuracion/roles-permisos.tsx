"use client"

import { useCallback, useEffect, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Loader2, ShieldCheck, Store, Users, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog"
import { EmptyState } from "@/components/ui/empty-state"

type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"

interface Usuario {
  id: string
  nombre: string
  email: string
  rol: Rol
  sucursalId: string | null
  activo: boolean
  porcentajeComision: number
}

/**
 * Los tres roles, con lo que significan en el taller.
 *
 * El texto describe lo que la persona PUEDE HACER, no como esta modelado el
 * sistema: el dueño elige "quien atiende el mostrador", no un valor de enum.
 */
const ROLES: { valor: Rol; nombre: string; icono: typeof Wrench; resumen: string }[] = [
  {
    valor: "ADMIN",
    nombre: "Administrador",
    icono: ShieldCheck,
    resumen: "Ve y edita todo: configuración, finanzas, comisiones y el equipo.",
  },
  {
    valor: "TECNICO",
    nombre: "Técnico",
    icono: Wrench,
    resumen: "Recibe órdenes asignadas, cotiza y cobra comisión por reparación.",
  },
  {
    valor: "VENDEDOR",
    nombre: "Vendedor",
    icono: Store,
    resumen: "Atiende el mostrador, vende por el POS y cobra comisión por venta.",
  },
]

/** Los roles cuya comisión sale de la misma columna. Ver el modal. */
const COBRAN_COMISION: Rol[] = ["TECNICO", "VENDEDOR"]

const BADGE_POR_ROL: Record<Rol, "default" | "infoSoft" | "successSoft"> = {
  ADMIN: "default",
  TECNICO: "infoSoft",
  VENDEDOR: "successSoft",
}

/** Los permisos opt-in de la organización, agrupados por el rol que amplían. */
const PERMISOS: { rol: Rol; campo: string; titulo: string; detalle: string }[] = [
  {
    rol: "TECNICO",
    campo: "tecnicosOperanPos",
    titulo: "Vender desde el Punto de Venta",
    detalle:
      "Puede vender por el POS y ver sus propias ventas. Sigue siendo técnico: conserva sus órdenes asignadas y sus comisiones de reparación. No incluye anular ni editar ventas, registrar pagos ni crear devoluciones.",
  },
  {
    rol: "TECNICO",
    campo: "tecnicosCobranCotizaciones",
    titulo: "Cobrar sus propias cotizaciones",
    detalle:
      "Puede convertir en venta las cotizaciones aceptadas que él mismo creó, sin depender de un administrador. No alcanza a las cotizaciones de otros técnicos, ni a eliminarlas, revisarlas o convertirlas en orden de servicio.",
  },
  {
    rol: "VENDEDOR",
    campo: "vendedoresAdministranInventario",
    titulo: "Administrar el inventario",
    detalle:
      "Puede gestionar productos, stock, depósitos, ajustes y conteos. Apagado, el inventario es solo de administradores.",
  },
  {
    rol: "VENDEDOR",
    campo: "vendedoresManejanCaja",
    titulo: "Abrir y cerrar la caja",
    detalle:
      "Puede abrir la caja de su sucursal, cerrarla con arqueo y cargar movimientos manuales. No incluye el historial de cierres ni la exportación.",
  },
]

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function RolesPermisos({ allowEdit }: { allowEdit: boolean }) {
  const { data: equipo, isLoading, mutate } = useSWR<Usuario[]>("/api/usuarios", fetcher)
  const [editando, setEditando] = useState<Usuario | null>(null)

  return (
    <div className="space-y-6">
      <Equipo
        equipo={equipo}
        cargando={isLoading}
        allowEdit={allowEdit}
        onCambiarRol={setEditando}
      />

      <PermisosDelEquipo allowEdit={allowEdit} />

      {editando && (
        <CambiarRolDialog
          usuario={editando}
          onCerrar={() => setEditando(null)}
          onListo={() => {
            setEditando(null)
            mutate()
          }}
        />
      )}
    </div>
  )
}

function Equipo({
  equipo,
  cargando,
  allowEdit,
  onCambiarRol,
}: {
  equipo: Usuario[] | undefined
  cargando: boolean
  allowEdit: boolean
  onCambiarRol: (u: Usuario) => void
}) {
  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Equipo</CardTitle>
        <CardDescription>
          Todos los que trabajan en el taller. El rol define a qué secciones entra cada uno.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        {cargando ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            <span className="text-sm">Cargando el equipo…</span>
          </div>
        ) : !equipo?.length ? (
          <EmptyState
            icon={Users}
            title="Todavía no hay nadie más"
            description="Cuando des de alta técnicos o vendedores, van a aparecer acá."
          />
        ) : (
          <ul className="divide-y divide-border">
            {equipo.map((u) => {
              const rol = ROLES.find((r) => r.valor === u.rol)
              return (
                <li
                  key={u.id}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{u.nombre}</span>
                      <Badge variant={BADGE_POR_ROL[u.rol]}>{rol?.nombre ?? u.rol}</Badge>
                      {/*
                        `users.activo` NO bloquea el acceso: solo saca a la
                        persona de los desplegables de asignación. Etiquetarla
                        "Inactivo" le haría creer al dueño que le sacó la
                        entrada al sistema, que es otra cosa y se maneja en
                        otro lado. Se nombra por lo que hace.
                      */}
                      {!u.activo && (
                        <Badge variant="outline">No recibe asignaciones</Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!allowEdit}
                    onClick={() => onCambiarRol(u)}
                    className="shrink-0 self-start sm:self-auto"
                  >
                    Cambiar rol
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function CambiarRolDialog({
  usuario,
  onCerrar,
  onListo,
}: {
  usuario: Usuario
  onCerrar: () => void
  onListo: () => void
}) {
  const [rol, setRol] = useState<Rol>(usuario.rol)
  const [comision, setComision] = useState(String(usuario.porcentajeComision ?? 0))
  const [guardando, setGuardando] = useState(false)

  const rolAnterior = ROLES.find((r) => r.valor === usuario.rol)
  const cambia = rol !== usuario.rol
  const pideComision = cambia && COBRAN_COMISION.includes(rol)

  const guardar = async () => {
    setGuardando(true)
    try {
      const res = await fetch(`/api/usuarios/${usuario.id}/rol`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rol,
          ...(pideComision ? { porcentajeComision: Number(comision) } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo cambiar el rol")
        return
      }
      toast.success(data.message)
      onListo()
    } catch {
      toast.error("No se pudo cambiar el rol. Revisá la conexión y probá de nuevo.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onCerrar()}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Cambiar el rol de {usuario.nombre}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Hoy es {rolAnterior?.nombre ?? usuario.rol}.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4">
          {/*
            Tres opciones a la vista en vez de un desplegable: el dueño compara
            lo que gana y lo que pierde la persona sin abrir nada. Además
            esquiva el bug conocido de Radix Select, que devuelve valor vacío
            cuando lo setean desde afuera con el dropdown cerrado.
          */}
          <fieldset className="space-y-2">
            <legend className="sr-only">Rol</legend>
            {ROLES.map((r) => {
              const Icono = r.icono
              const elegido = rol === r.valor
              return (
                <label
                  key={r.valor}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    elegido ? "border-primary bg-primary/5" : "hover:bg-accent/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="rol"
                    value={r.valor}
                    checked={elegido}
                    onChange={() => setRol(r.valor)}
                    className="mt-1 h-4 w-4 border-border text-primary focus:ring-primary"
                  />
                  <span className="flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Icono className="h-4 w-4 text-muted-foreground" />
                      {r.nombre}
                      {r.valor === usuario.rol && (
                        <span className="text-xs font-normal text-muted-foreground">
                          (actual)
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {r.resumen}
                    </span>
                  </span>
                </label>
              )
            })}
          </fieldset>

          {/*
            El % de comisión se re-confirma al entrar a un rol que la cobra.
            `users.porcentaje_comision` es UNA sola columna para la comisión de
            reparación y la de venta, así que sin este paso un técnico al 15%
            pasa a cobrar 15% sobre CADA VENTA sin que nadie lo decida. Viene
            pre-cargado con el número viejo, pero el texto dice sobre qué se va
            a aplicar ahora: el riesgo no es el número, es la base de cálculo.
          */}
          {pideComision && (
            <div className="space-y-1.5 rounded-lg border border-warning/30 bg-warning-50 p-3 dark:bg-warning/10">
              <Label htmlFor="comision" className="text-sm font-medium">
                Comisión como {ROLES.find((r) => r.valor === rol)?.nombre}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="comision"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={comision}
                  onChange={(e) => setComision(e.target.value)}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {usuario.rol === "ADMIN"
                  ? `Se va a aplicar sobre ${rol === "TECNICO" ? "cada reparación" : "cada venta"}.`
                  : `Venía de ${usuario.porcentajeComision}% sobre ${
                      usuario.rol === "TECNICO" ? "reparaciones" : "ventas"
                    }. Ahora se aplica sobre ${
                      rol === "TECNICO" ? "cada reparación" : "cada venta"
                    }.`}
              </p>
            </div>
          )}

          {cambia && (
            <p className="text-xs text-muted-foreground">
              {usuario.nombre} va a tener que volver a iniciar sesión para que el
              cambio tenga efecto.
            </p>
          )}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={!cambia || guardando}>
            {guardando ? "Guardando…" : "Cambiar rol"}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function PermisosDelEquipo({ allowEdit }: { allowEdit: boolean }) {
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/configuracion")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        // Solo los permisos que la API reconoce. Un permiso que se dibuja pero
        // que el servidor no sabe guardar es peor que uno que falta: el dueño
        // lo prende, no pasa nada y no hay error. Esto ademas cubre la ventana
        // en la que un permiso nuevo ya esta en esta pantalla pero su ruta
        // todavia no se desplego.
        setFlags(
          Object.fromEntries(
            PERMISOS.filter((p) => p.campo in d).map((p) => [p.campo, !!d[p.campo]]),
          ),
        )
      })
      .catch(() => {})
  }, [])

  const alternar = useCallback(
    async (campo: string, valor: boolean) => {
      // Optimista: el checkbox responde solo, y si el servidor rechaza vuelve
      // atrás. Un toggle que tarda medio segundo en moverse se aprieta dos
      // veces.
      setFlags((f) => (f ? { ...f, [campo]: valor } : f))
      setGuardando(campo)
      try {
        const res = await fetch("/api/configuracion", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [campo]: valor }),
        })
        if (!res.ok) throw new Error()
        toast.success("Permiso actualizado")
      } catch {
        setFlags((f) => (f ? { ...f, [campo]: !valor } : f))
        toast.error("No se pudo guardar el permiso. Probá de nuevo.")
      } finally {
        setGuardando(null)
      }
    },
    []
  )

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Permisos del equipo</CardTitle>
        <CardDescription>
          Ampliaciones opcionales sobre cada rol. Se aplican a todos los que
          tengan ese rol, no a una persona en particular.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 p-4 pt-0 sm:p-6 sm:pt-0">
        {ROLES.filter((r) =>
          PERMISOS.some((p) => p.rol === r.valor && flags !== null && p.campo in flags),
        ).map((r) => (
          <section key={r.valor} className="space-y-2">
            <h3 className="text-sm font-medium">{r.nombre}s</h3>
            {PERMISOS.filter((p) => p.rol === r.valor && flags !== null && p.campo in flags).map((p) => (
              <label
                key={p.campo}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/40"
              >
                <input
                  type="checkbox"
                  checked={flags?.[p.campo] ?? false}
                  onChange={(e) => alternar(p.campo, e.target.checked)}
                  disabled={!allowEdit || flags === null || guardando === p.campo}
                  className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{p.titulo}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {p.detalle}
                  </span>
                </span>
              </label>
            ))}
          </section>
        ))}
      </CardContent>
    </Card>
  )
}
