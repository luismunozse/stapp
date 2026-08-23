"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  X,
  Plus,
  Trash2,
  Copy,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react"
import { DraftRestoredNotice } from "@/components/ui/draft-restored-notice"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import { useTerminologia } from "@/contexts/currency-context"
import { useFormDraft } from "@/hooks/use-form-draft"
import { ignoreSelectEcho } from "@/lib/radix-select-echo"

interface ProveedorLite {
  id: string
  nombre: string
  activo?: boolean
}

interface Row {
  id: string
  nombre: string
  stock: string
  precioCompra: string
  precioVenta: string
  barcode: string
}

interface RowError {
  nombre?: string
  stock?: string
  precioCompra?: string
  precioVenta?: string
}

interface DuplicateMatch {
  id: string
  codigo: string
  nombre: string
  categoria: string
  tipoDispositivo: string
  stock: number
  score: number
}

const DUPLICATE_THRESHOLD = 0.65

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const categoriasPorTipo: Record<string, string[]> = {
  CELULAR: ["Pantallas", "Protectores", "Baterías", "Fundas", "Cargadores", "Flex", "Módulos", "Otros"],
  COMPUTADORA: ["Pantallas", "Teclados", "Baterías", "Memorias", "Discos", "Cargadores", "Otros"],
  TABLET: ["Pantallas", "Protectores", "Baterías", "Fundas", "Cargadores", "Flex", "Otros"],
  CONSOLA: ["Joysticks", "Fuentes", "Flex", "Lectoras", "Coolers", "Otros"],
  SMARTWATCH: ["Mallas", "Pantallas", "Baterías", "Cargadores", "Otros"],
  IMPRESORA: ["Cartuchos", "Tóners", "Cabezales", "Rodillos", "Fuentes", "Placas", "Otros"],
  NOTEBOOK: ["Pantallas", "Teclados", "Baterías", "Memorias", "Discos", "Cargadores", "Bisagras", "Otros"],
  LAPTOP: ["Pantallas", "Teclados", "Baterías", "Memorias", "Discos", "Cargadores", "Bisagras", "Otros"],
  TELEVISION: ["Pantallas", "Fuentes", "Placas", "LED", "Cables", "Controles", "Otros"],
  TV: ["Pantallas", "Fuentes", "Placas", "LED", "Cables", "Controles", "Otros"],
  HELADERA: ["Compresores", "Termostatos", "Motores", "Válvulas", "Resistencias", "Otros"],
  MICROONDAS: ["Magnetrones", "Fusibles", "Motores", "Placas", "Otros"],
  LAVARROPAS: ["Motores", "Bombas", "Correas", "Electrválvulas", "Placas", "Otros"],
  AIRE_ACONDICIONADO: ["Compresores", "Filtros", "Motores", "Placas", "Gas refrigerante", "Otros"],
  ACCESORIOS: ["Auriculares", "Parlantes", "Cables", "Adaptadores", "Cargadores", "Soportes", "Otros"],
  TODOS: ["Pantallas", "Baterías", "Fundas", "Teclados", "Memorias", "Cargadores", "Otros"],
}

const proveedoresFetcher = async (url: string): Promise<ProveedorLite[]> => {
  // Endpoint puede devolver `{error}` ante 401/500. Sin guard, .filter()
  // rompe en runtime.
  const res = await fetch(url)
  const data = await res.json().catch(() => null)
  return Array.isArray(data) ? data : []
}

function newRow(overrides: Partial<Row> = {}): Row {
  return {
    id: crypto.randomUUID(),
    nombre: "",
    stock: "0",
    precioCompra: "",
    precioVenta: "",
    barcode: "",
    ...overrides,
  }
}

/**
 * Una fila TAL COMO SE PERSISTE: sin el `id`.
 *
 * Ese id es una key de React generada con `crypto.randomUUID()`, no un dato del
 * producto -- no significa nada del otro lado de un reinicio y nada del lote lo
 * referencia (`matchesByRow` y `rowErrors` se recalculan). Guardarlo solo abre
 * la puerta a que dos filas vuelvan con el mismo, y ahi editar o borrar una toca
 * a las dos. Se regenera al restaurar, que es la unica forma de garantizar que
 * sean unicos.
 */
type BulkDraftRow = Omit<Row, "id">

/** Lo que se persiste de esta pantalla: los seis valores compartidos de arriba
 *  y las filas sin su id. Nada de esto es sensible -- son nombres de producto y
 *  precios de lista -- y todo es lo que cuesta volver a tipear. */
interface BulkDraftValue {
  tipoDispositivo: string
  categoria: string
  proveedorId: string
  defaultStock: string
  defaultPrecioCompra: string
  defaultPrecioVenta: string
  rows: BulkDraftRow[]
}

function isBulkDraftRow(value: unknown): value is BulkDraftRow {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return (
    typeof row.nombre === "string" &&
    typeof row.stock === "string" &&
    typeof row.precioCompra === "string" &&
    typeof row.precioVenta === "string" &&
    typeof row.barcode === "string"
  )
}

const FILAS_INICIALES = 3

interface InventarioBulkFormProps {
  onClose: () => void
  onSuccess: (createdCount: number) => void
}

export function InventarioBulkForm({ onClose, onSuccess }: InventarioBulkFormProps) {
  const term = useTerminologia()
  const { tipos: tiposDispositivo, loading: tiposLoading } = useTiposDispositivo({
    incluirTodos: true,
  })
  const { data: proveedores = [] } = useSWR<ProveedorLite[]>(
    "/api/proveedores",
    proveedoresFetcher,
    { revalidateOnFocus: false }
  )
  const proveedoresActivos = useMemo(
    () => proveedores.filter((p) => p.activo !== false),
    [proveedores]
  )

  const [tipoDispositivo, setTipoDispositivo] = useState("")
  const [categoria, setCategoria] = useState("")
  const [proveedorId, setProveedorId] = useState<string>("")
  const [defaultPrecioCompra, setDefaultPrecioCompra] = useState("")
  const [defaultPrecioVenta, setDefaultPrecioVenta] = useState("")
  const [defaultStock, setDefaultStock] = useState("0")

  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: FILAS_INICIALES }, () => newRow())
  )
  const prevDefaultsRef = useRef({
    stock: "0",
    precioCompra: "",
    precioVenta: "",
  })

  // Propagar cambios de defaults a las filas: se pisan solo valores vacíos
  // o que coinciden con el default anterior (así respetamos ediciones manuales).
  useEffect(() => {
    const prev = prevDefaultsRef.current
    const next = {
      stock: defaultStock,
      precioCompra: defaultPrecioCompra,
      precioVenta: defaultPrecioVenta,
    }
    if (
      prev.stock === next.stock &&
      prev.precioCompra === next.precioCompra &&
      prev.precioVenta === next.precioVenta
    ) {
      return
    }
    setRows((current) =>
      current.map((r) => {
        const patch: Partial<Row> = {}
        if (next.stock !== prev.stock && (r.stock === "" || r.stock === prev.stock)) {
          patch.stock = next.stock
        }
        if (
          next.precioCompra !== prev.precioCompra &&
          (r.precioCompra === "" || r.precioCompra === prev.precioCompra)
        ) {
          patch.precioCompra = next.precioCompra
        }
        if (
          next.precioVenta !== prev.precioVenta &&
          (r.precioVenta === "" || r.precioVenta === prev.precioVenta)
        ) {
          patch.precioVenta = next.precioVenta
        }
        return Object.keys(patch).length > 0 ? { ...r, ...patch } : r
      })
    )
    prevDefaultsRef.current = next
  }, [defaultStock, defaultPrecioCompra, defaultPrecioVenta])

  // --- Borrador local (useFormDraft) ----------------------------------------
  //
  // Es la pantalla donde mas se escribe de una sentada -- seis valores
  // compartidos y una tabla sin techo -- y hasta ahora se perdia entera ante un
  // vencimiento de sesion o el cierre de la pestana.
  //
  // Todo el estado vive en useState (no hay react-hook-form aca), asi que el
  // snapshot se arma a mano. Una entrada por usuario: un lote no tiene id, y dos
  // lotes en paralelo no es un caso real.
  /** Raiz del gate de interaccion del hook. Ver la nota del <form> en el render:
   *  sin un <form> alrededor, el hook no cuenta ningun control de esta pantalla
   *  y no graba nunca. */
  const formRef = useRef<HTMLFormElement>(null)
  const [appliedDraft, setAppliedDraft] = useState<BulkDraftValue | null>(null)
  const draftAppliedRef = useRef<BulkDraftValue | null>(null)
  const { draft, ready: draftReady, clearDraft, notifyChange } = useFormDraft<BulkDraftValue>({
    feature: "inventario-bulk-form",
    getValue: () => ({
      tipoDispositivo,
      categoria,
      proveedorId,
      defaultStock,
      defaultPrecioCompra,
      defaultPrecioVenta,
      // Sin el id (ver BulkDraftRow). De paso el sobre queda mas chico, que en
      // una tabla sin techo no es un detalle: el hook se come el
      // QuotaExceededError en silencio y ahi la persistencia deja de funcionar
      // sin que nadie se entere.
      rows: rows.map(({ id: _id, ...row }) => row),
    }),
    rootRef: formRef,
    validate: (data) => {
      const value = data as BulkDraftValue
      return (
        !!value &&
        typeof value === "object" &&
        typeof value.tipoDispositivo === "string" &&
        typeof value.categoria === "string" &&
        Array.isArray(value.rows) &&
        value.rows.length > 0 &&
        value.rows.every(isBulkDraftRow)
      )
    },
  })

  /** El aviso no puede sobrevivir al borrador que anuncia. */
  const draftNoticeVisible = draft !== null && appliedDraft === draft

  // Todo el estado de esta pantalla es useState y no re-renderiza por si solo
  // fuera de los setters, asi que no hace falta notificar por suscripcion: cada
  // tecla ya produce un commit. `notifyChange` se usa igual al restaurar, para
  // que el hook no espere a la proxima tecla para reprogramar.
  useEffect(() => {
    if (!draftReady || !draft || draftAppliedRef.current === draft) return
    draftAppliedRef.current = draft
    setTipoDispositivo(draft.tipoDispositivo)
    setCategoria(draft.categoria)
    setProveedorId(typeof draft.proveedorId === "string" ? draft.proveedorId : "")
    setDefaultStock(typeof draft.defaultStock === "string" ? draft.defaultStock : "0")
    setDefaultPrecioCompra(
      typeof draft.defaultPrecioCompra === "string" ? draft.defaultPrecioCompra : ""
    )
    setDefaultPrecioVenta(
      typeof draft.defaultPrecioVenta === "string" ? draft.defaultPrecioVenta : ""
    )
    setRows(draft.rows.map((row) => newRow(row)))
    // Los defaults restaurados NO son un cambio de defaults: sin esto, el efecto
    // de propagacion de mas arriba los compara contra los iniciales, ve una
    // diferencia y pisa toda fila cuyo valor coincida con el default viejo --
    // una fila que el operador habia puesto en 0 a proposito vuelve con el stock
    // por defecto del lote.
    prevDefaultsRef.current = {
      stock: draft.defaultStock,
      precioCompra: draft.defaultPrecioCompra,
      precioVenta: draft.defaultPrecioVenta,
    }
    setAppliedDraft(draft)
    notifyChange()
  }, [draftReady, draft, notifyChange])

  const discardDraft = () => {
    // El aviso se apaga solo: `clearDraft` deja `draft` en null en este mismo
    // commit y de ahi se deriva (ver draftNoticeVisible).
    clearDraft()
    setTipoDispositivo("")
    setCategoria("")
    setProveedorId("")
    setDefaultStock("0")
    setDefaultPrecioCompra("")
    setDefaultPrecioVenta("")
    setRows(Array.from({ length: FILAS_INICIALES }, () => newRow()))
    prevDefaultsRef.current = { stock: "0", precioCompra: "", precioVenta: "" }
  }

  // Chequeo de duplicados contra inventario existente (debounced).
  // Corre cuando hay tipo + categoría. Por cada fila con nombre de 3+ chars,
  // llama al endpoint fuzzy y guarda matches sobre umbral.
  // AbortController vive fuera del setTimeout para abortar fetches en vuelo
  // cuando el usuario sigue tipeando antes de que respondan.
  useEffect(() => {
    if (!tipoDispositivo || !categoria) {
      setMatchesByRow({})
      return
    }
    const controller = new AbortController()
    const handle = setTimeout(async () => {
      const entries = await Promise.all(
        rows
          .filter((r) => r.nombre.trim().length >= 3)
          .map(async (r) => {
            try {
              const params = new URLSearchParams({
                nombre: r.nombre.trim(),
                tipo: tipoDispositivo,
                categoria,
              })
              const res = await fetch(
                `/api/inventario/check-duplicate?${params}`,
                { signal: controller.signal }
              )
              if (!res.ok) return [r.id, []] as const
              const body = await res.json()
              const matches: DuplicateMatch[] = (body.matches || []).filter(
                (m: DuplicateMatch) => m.score >= DUPLICATE_THRESHOLD
              )
              return [r.id, matches] as const
            } catch {
              return [r.id, [] as DuplicateMatch[]] as const
            }
          })
      )
      if (controller.signal.aborted) return
      const next: Record<string, DuplicateMatch[]> = {}
      for (const [id, matches] of entries) {
        if (matches.length > 0) next[id] = [...matches]
      }
      setMatchesByRow(next)
    }, 500)
    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [rows, tipoDispositivo, categoria])

  // Duplicados dentro del lote: filas con el mismo nombre normalizado.
  const inBatchDuplicates = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const r of rows) {
      const key = normalizeName(r.nombre)
      if (!key) continue
      if (!groups[key]) groups[key] = []
      groups[key].push(r.id)
    }
    const conflicts = new Set<string>()
    for (const ids of Object.values(groups)) {
      if (ids.length > 1) ids.forEach((id) => conflicts.add(id))
    }
    return conflicts
  }, [rows])
  const [rowErrors, setRowErrors] = useState<Record<string, RowError>>({})
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    createdCount: number
    errors: { index: number; nombre: string; error: string }[]
  } | null>(null)
  const [matchesByRow, setMatchesByRow] = useState<Record<string, DuplicateMatch[]>>({})
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false)

  const categoriasDisponibles = useMemo(() => {
    if (!tipoDispositivo) return []
    const cfg = tiposDispositivo.find((t) => t.codigo === tipoDispositivo)
      ?.config?.categoriasInventario as string[] | undefined
    if (cfg && cfg.length > 0) return cfg
    return categoriasPorTipo[tipoDispositivo] || categoriasPorTipo.TODOS
  }, [tipoDispositivo, tiposDispositivo])

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setRowErrors((prev) => {
      if (!prev[id]) return prev
      const { [id]: _, ...rest } = prev
      return rest
    })
  }

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      newRow({
        stock: defaultStock,
        precioCompra: defaultPrecioCompra,
        precioVenta: defaultPrecioVenta,
      }),
    ])
  }

  const duplicateRow = (id: string) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === id)
      if (idx === -1) return prev
      const copy = { ...prev[idx], id: crypto.randomUUID() }
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]
    })
  }

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev))
  }

  const validate = () => {
    setGlobalError(null)
    if (!tipoDispositivo) {
      setGlobalError(`Seleccioná un tipo de ${term("equipo").toLowerCase()}`)
      return null
    }
    if (!categoria) {
      setGlobalError("Seleccioná una categoría")
      return null
    }

    const nonEmpty = rows.filter((r) => r.nombre.trim().length > 0)
    if (nonEmpty.length === 0) {
      setGlobalError("Agregá al menos un producto con nombre")
      return null
    }

    const errs: Record<string, RowError> = {}
    const payload: {
      nombre: string
      categoria: string
      tipoDispositivo: string
      stock: number
      precioCompra: number
      precioVenta: number
      proveedorId: string | null
      barcode: string | null
    }[] = []

    for (const r of nonEmpty) {
      const re: RowError = {}
      const stock = Number(r.stock)
      const pc = Number(r.precioCompra)
      const pv = Number(r.precioVenta)
      if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) {
        re.stock = "Stock inválido"
      }
      if (!Number.isFinite(pc) || pc < 0) re.precioCompra = "Precio inválido"
      if (!Number.isFinite(pv) || pv < 0) re.precioVenta = "Precio inválido"
      if (Object.keys(re).length > 0) {
        errs[r.id] = re
        continue
      }
      payload.push({
        nombre: r.nombre.trim(),
        categoria,
        tipoDispositivo,
        stock,
        precioCompra: pc,
        precioVenta: pv,
        proveedorId: proveedorId || null,
        barcode: r.barcode.trim() || null,
      })
    }

    if (Object.keys(errs).length > 0) {
      setRowErrors(errs)
      setGlobalError("Revisá los errores en las filas")
      return null
    }

    return payload
  }

  const hasWarnings = useMemo(() => {
    const rowsWithName = rows.filter((r) => r.nombre.trim().length > 0)
    const anyDupExisting = rowsWithName.some((r) => matchesByRow[r.id]?.length)
    const anyDupBatch = rowsWithName.some((r) => inBatchDuplicates.has(r.id))
    return anyDupExisting || anyDupBatch
  }, [rows, matchesByRow, inBatchDuplicates])

  const handleSubmitClick = () => {
    const payload = validate()
    if (!payload) return
    if (hasWarnings) {
      setShowDuplicateConfirm(true)
      return
    }
    void doSubmit()
  }

  const doSubmit = async () => {
    const payload = validate()
    if (!payload) return
    setShowDuplicateConfirm(false)

    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch("/api/inventario/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      })
      const body = await res.json()
      if (!res.ok && res.status !== 207) {
        setGlobalError(body?.error || "Error al guardar")
        setSubmitting(false)
        return
      }
      setResult({
        createdCount: body.createdCount ?? 0,
        errors: body.errors ?? [],
      })
      if ((body.errors?.length ?? 0) === 0) {
        // Solo el lote entero. Con un 207 parcial las filas que fallaron siguen
        // en pantalla para corregirlas: borrar el borrador ahi es perder
        // exactamente lo que queda por hacer.
        clearDraft()
        onSuccess(body.createdCount ?? 0)
      }
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Error de red")
    } finally {
      setSubmitting(false)
    }
  }

  const totalConNombre = rows.filter((r) => r.nombre.trim().length > 0).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <Card className="relative w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between border-b">
          <div>
            <CardTitle className="text-lg">Carga en lista</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Creá varios productos a la vez. Ideal para fundas o accesorios con
              el mismo precio y distinto modelo.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={submitting}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        {/*
          El <form> no envia nada -- la accion primaria sigue siendo el boton
          del pie, fuera de el, y `onSubmit` corta un Enter accidental antes de
          que el navegador navegue. Existe porque el gate de interaccion de
          useFormDraft solo cuenta controles que pertenecen a un <form> (o a una
          capa portalada que un <form> haya abierto, como el listado de un
          Select): sin esto, escribir en esta pantalla no marcaba nada como
          sucio y el borrador no se grababa nunca.
        */}
        <form
          ref={formRef}
          onSubmit={(e) => e.preventDefault()}
          className="contents"
        >
        <CardContent className="overflow-y-auto flex-1 space-y-4 pt-4">
          {draftNoticeVisible && <DraftRestoredNotice onDiscard={discardDraft} />}

          {/* Defaults compartidos */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-muted/40 rounded-md">
            <div>
              <Label className="text-xs">Tipo de {term("equipo").toLowerCase()} *</Label>
              <Select
                value={tipoDispositivo}
                onValueChange={ignoreSelectEcho((v) => {
                  setTipoDispositivo(v)
                  setCategoria("")
                })}
                disabled={tiposLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {tiposDispositivo.map((t) => (
                    <SelectItem key={t.id} value={t.codigo}>
                      {t.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Categoría *</Label>
              <Select
                value={categoria}
                onValueChange={ignoreSelectEcho(setCategoria)}
                disabled={!tipoDispositivo || categoriasDisponibles.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {categoriasDisponibles.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Proveedor</Label>
              <Select
                value={proveedorId || "none"}
                onValueChange={ignoreSelectEcho((v) => setProveedorId(v === "none" ? "" : v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin proveedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin proveedor</SelectItem>
                  {proveedoresActivos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              {/* htmlFor/id: estos tres tenian el label solo al lado del input,
                  sin asociacion, asi que un lector de pantalla los anunciaba
                  como campos sin nombre. */}
              <Label htmlFor="bulk-default-stock" className="text-xs">Stock por defecto</Label>
              <Input
                id="bulk-default-stock"
                type="number"
                min={0}
                value={defaultStock}
                onChange={(e) => setDefaultStock(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="bulk-default-precio-compra" className="text-xs">Precio compra por defecto</Label>
              <Input
                id="bulk-default-precio-compra"
                type="number"
                min={0}
                step="0.01"
                value={defaultPrecioCompra}
                onChange={(e) => setDefaultPrecioCompra(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="bulk-default-precio-venta" className="text-xs">Precio venta por defecto</Label>
              <Input
                id="bulk-default-precio-venta"
                type="number"
                min={0}
                step="0.01"
                value={defaultPrecioVenta}
                onChange={(e) => setDefaultPrecioVenta(e.target.value)}
              />
            </div>
          </div>

          {/* Tabla */}
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="text-left px-2 py-2 font-medium w-8">#</th>
                  <th className="text-left px-2 py-2 font-medium min-w-[220px]">
                    Nombre *
                  </th>
                  <th className="text-left px-2 py-2 font-medium w-24">Stock</th>
                  <th className="text-left px-2 py-2 font-medium w-28">P. compra</th>
                  <th className="text-left px-2 py-2 font-medium w-28">P. venta</th>
                  <th className="text-left px-2 py-2 font-medium w-32">Barcode</th>
                  <th className="px-2 py-2 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const err = rowErrors[r.id] || {}
                  const rowMatches = matchesByRow[r.id] || []
                  const inBatchDup = inBatchDuplicates.has(r.id)
                  const topMatch = rowMatches[0]
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                      <td className="px-2 py-1">
                        <div className="relative">
                          <Input
                            value={r.nombre}
                            onChange={(e) => updateRow(r.id, { nombre: e.target.value })}
                            placeholder="Ej: Funda iPhone 15 Pro"
                            className={
                              err.nombre
                                ? "border-red-500"
                                : topMatch || inBatchDup
                                ? "border-amber-500 pr-8"
                                : ""
                            }
                          />
                          {(topMatch || inBatchDup) && (
                            <div
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-amber-600"
                              title={
                                inBatchDup
                                  ? "Otra fila de este lote tiene el mismo nombre"
                                  : `Posible duplicado: ${topMatch.nombre} (${topMatch.codigo}) — stock ${topMatch.stock}`
                              }
                            >
                              <AlertTriangle className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        {topMatch && !inBatchDup && (
                          <div className="text-[11px] text-amber-700 mt-0.5">
                            Ya existe: {topMatch.nombre} ({topMatch.codigo}) · stock{" "}
                            {topMatch.stock}
                          </div>
                        )}
                        {inBatchDup && (
                          <div className="text-[11px] text-amber-700 mt-0.5">
                            Nombre repetido en este lote
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          min={0}
                          value={r.stock}
                          onChange={(e) => updateRow(r.id, { stock: e.target.value })}
                          className={err.stock ? "border-red-500" : ""}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={r.precioCompra}
                          onChange={(e) =>
                            updateRow(r.id, { precioCompra: e.target.value })
                          }
                          placeholder={defaultPrecioCompra || "0"}
                          className={err.precioCompra ? "border-red-500" : ""}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={r.precioVenta}
                          onChange={(e) =>
                            updateRow(r.id, { precioVenta: e.target.value })
                          }
                          placeholder={defaultPrecioVenta || "0"}
                          className={err.precioVenta ? "border-red-500" : ""}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={r.barcode}
                          onChange={(e) =>
                            updateRow(r.id, { barcode: e.target.value })
                          }
                          placeholder="Opcional"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => duplicateRow(r.id)}
                            title="Duplicar fila"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600 hover:text-red-700"
                            onClick={() => removeRow(r.id)}
                            disabled={rows.length === 1}
                            title="Eliminar fila"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center">
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-4 w-4 mr-1" />
              Agregar fila
            </Button>
            <span className="text-xs text-muted-foreground">
              {totalConNombre} producto{totalConNombre === 1 ? "" : "s"} a cargar
            </span>
          </div>

          {globalError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {globalError}
            </div>
          )}

          {result && (
            <div className="space-y-2">
              {result.createdCount > 0 && (
                <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 border border-green-200 rounded-md text-sm">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Se crearon {result.createdCount} producto
                  {result.createdCount === 1 ? "" : "s"}.
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">
                  <div className="flex items-center gap-2 font-medium mb-1">
                    <AlertCircle className="h-4 w-4" />
                    {result.errors.length} fila
                    {result.errors.length === 1 ? "" : "s"} con error:
                  </div>
                  <ul className="list-disc pl-6 space-y-0.5">
                    {result.errors.map((e, i) => (
                      <li key={i}>
                        <span className="font-medium">{e.nombre}</span>: {e.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
        </form>

        {showDuplicateConfirm && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-4 z-10">
            <Card className="w-full max-w-lg">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-amber-700">
                  <AlertTriangle className="h-5 w-5" />
                  Posibles duplicados detectados
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Algunos nombres ya existen en el inventario o están repetidos en
                  este lote:
                </p>
                <ul className="list-disc pl-6 space-y-1 max-h-56 overflow-y-auto">
                  {rows
                    .filter(
                      (r) =>
                        r.nombre.trim().length > 0 &&
                        (matchesByRow[r.id]?.length || inBatchDuplicates.has(r.id))
                    )
                    .map((r) => {
                      const top = matchesByRow[r.id]?.[0]
                      return (
                        <li key={r.id}>
                          <span className="font-medium">{r.nombre}</span>
                          {inBatchDuplicates.has(r.id) && (
                            <span className="text-amber-700"> — repetido en el lote</span>
                          )}
                          {top && !inBatchDuplicates.has(r.id) && (
                            <span className="text-muted-foreground">
                              {" "}
                              · ya existe como <span className="font-mono">{top.codigo}</span>{" "}
                              ({top.nombre})
                            </span>
                          )}
                        </li>
                      )
                    })}
                </ul>
                <p className="text-muted-foreground">
                  ¿Querés crearlos igual? Los productos existentes no se modifican.
                </p>
              </CardContent>
              <div className="border-t p-3 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowDuplicateConfirm(false)}
                >
                  Revisar
                </Button>
                <Button onClick={doSubmit} disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Crear igual
                </Button>
              </div>
            </Card>
          </div>
        )}

        <div className="border-t p-3 flex justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {result && result.createdCount > 0 ? "Cerrar" : "Cancelar"}
          </Button>
          <Button
            onClick={handleSubmitClick}
            disabled={submitting || totalConNombre === 0}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Crear {totalConNombre > 0 ? totalConNombre : ""} producto
            {totalConNombre === 1 ? "" : "s"}
          </Button>
        </div>
      </Card>
    </div>
  )
}
