"use client"

import { useState, useEffect, useMemo, useCallback, useId, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Search, User, ClipboardList, type LucideIcon } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useGlobalSearch } from "@/hooks/use-global-search"
import { OrderStatusBadge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { coincideComando, hrefResultado, type NavItem } from "@/lib/navegacion"
import { ABRIR_PALETA_EVENT } from "@/components/shared/command-palette-trigger"

type Entrada = {
  key: string
  href: string
  label: string
  detalle?: string
  icon: LucideIcon
  extra?: ReactNode
}

type Grupo = { id: string; titulo: string; entradas: Entrada[] }

interface GlobalSearchProps {
  /** Secciones visibles para el usuario (ya filtradas por rol y módulos). */
  navItems: NavItem[]
  /** Acciones rápidas visibles para el usuario (mismo filtro). */
  acciones: NavItem[]
}

function aEntrada(prefijo: string, item: NavItem): Entrada {
  return { key: `${prefijo}:${item.href}:${item.label}`, href: item.href, label: item.label, icon: item.icon }
}

/**
 * Paleta de comandos: buscar clientes y órdenes, ir a una sección o disparar
 * una acción. Se monta una sola vez (en el Navbar) y es la única que escucha
 * Ctrl/Cmd+K; los botones de las barras la abren con `abrirPaleta()`.
 */
export function GlobalSearch({ navItems, acciones }: GlobalSearchProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const { query, results, loading, hasResults, search, clear } = useGlobalSearch()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listboxId = useId()

  const close = useCallback(() => {
    setOpen(false)
    clear()
    setSelectedIndex(0)
  }, [clear])

  // Único listener del atajo. Ctrl/Cmd+K abre y cierra; funciona aun con el
  // foco en un campo porque ninguna caja de texto usa esa combinación.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    const onAbrir = () => setOpen(true)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener(ABRIR_PALETA_EVENT, onAbrir)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener(ABRIR_PALETA_EVENT, onAbrir)
    }
  }, [])

  const grupos = useMemo<Grupo[]>(() => {
    const acc: Grupo[] = []
    const accionesFiltradas = acciones.filter((a) => coincideComando(a, query))
    if (accionesFiltradas.length > 0) {
      acc.push({ id: "acciones", titulo: "Acciones", entradas: accionesFiltradas.map((a) => aEntrada("accion", a)) })
    }
    const secciones = navItems.filter((item) => coincideComando(item, query))
    if (secciones.length > 0) {
      acc.push({ id: "ir", titulo: "Ir a…", entradas: secciones.map((s) => aEntrada("ir", s)) })
    }
    if (results.clientes.length > 0) {
      acc.push({
        id: "clientes",
        titulo: "Clientes",
        entradas: results.clientes.map((c) => ({
          key: `cliente:${c.id}`,
          href: hrefResultado("cliente", c.id),
          label: c.nombre,
          detalle: [c.telefono, c.email].filter(Boolean).join(" · "),
          icon: User,
        })),
      })
    }
    if (results.ordenes.length > 0) {
      acc.push({
        id: "ordenes",
        titulo: "Órdenes",
        entradas: results.ordenes.map((o) => ({
          key: `orden:${o.id}`,
          href: hrefResultado("orden", o.id),
          label: `#${o.numero_orden}`,
          detalle: [o.dispositivo, o.cliente_nombre].filter(Boolean).join(" · "),
          icon: ClipboardList,
          extra: <OrderStatusBadge status={o.estado} />,
        })),
      })
    }
    return acc
  }, [acciones, navItems, query, results])

  const planas = useMemo(() => grupos.flatMap((g) => g.entradas), [grupos])
  const seleccion = Math.min(selectedIndex, Math.max(planas.length - 1, 0))

  const ir = (entrada: Entrada) => {
    close()
    router.push(entrada.href)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex(Math.min(seleccion + 1, planas.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex(Math.max(seleccion - 1, 0))
    } else if (e.key === "Enter" && planas[seleccion]) {
      e.preventDefault()
      ir(planas[seleccion])
    }
  }

  const buscando = query.trim().length >= 2
  const optionId = (i: number) => `${listboxId}-op-${i}`

  let indice = -1
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent className="top-[12vh] translate-y-0 data-[state=closed]:slide-out-to-top-[10%] data-[state=open]:slide-in-from-top-[10%] max-w-lg gap-0 p-0 pb-0 overflow-hidden">
        <DialogTitle className="sr-only">Buscar o ir a</DialogTitle>
        <DialogDescription className="sr-only">
          Buscá clientes y órdenes, saltá a una sección o empezá una acción.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b px-4 pr-12">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-activedescendant={planas.length > 0 ? optionId(seleccion) : undefined}
            aria-label="Buscar o ir a"
            value={query}
            onChange={(e) => {
              search(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Buscá un cliente, una orden o una sección…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            autoFocus
          />
        </div>

        <div id={listboxId} role="listbox" aria-label="Resultados" className="max-h-[60vh] overflow-y-auto py-2">
          {grupos.map((grupo) => (
            <div key={grupo.id} role="group" aria-label={grupo.titulo}>
              <div className="px-4 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{grupo.titulo}</div>
              {grupo.entradas.map((entrada) => {
                indice += 1
                const i = indice
                const Icon = entrada.icon
                return (
                  <div
                    key={entrada.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={seleccion === i}
                    onClick={() => ir(entrada)}
                    onMouseMove={() => seleccion !== i && setSelectedIndex(i)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-4 py-2 text-left",
                      seleccion === i && "bg-muted",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{entrada.label}</p>
                        {entrada.extra}
                      </div>
                      {entrada.detalle && (
                        <p className="truncate text-xs text-muted-foreground">{entrada.detalle}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          {buscando && loading && (
            <p className="px-4 py-3 text-center text-sm text-muted-foreground">Buscando clientes y órdenes…</p>
          )}
          {buscando && !loading && !hasResults && planas.length === 0 && (
            <p className="px-4 py-3 text-center text-sm text-muted-foreground">
              No encontramos nada para &quot;{query}&quot;
            </p>
          )}
        </div>

        <div className="hidden items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground sm:flex">
          <span>
            <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-xs">↑↓</kbd> navegar{" "}
            <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-xs">Enter</kbd> abrir
          </span>
          <span>
            <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-xs">Esc</kbd> cerrar
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
