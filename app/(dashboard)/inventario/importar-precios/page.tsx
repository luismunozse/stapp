"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FileSpreadsheet, Upload, Loader2, Check, X, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageShell } from "@/components/ui/page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { DraftRestoredNotice } from "@/components/ui/draft-restored-notice"
import { useFormDraft } from "@/hooks/use-form-draft"
import { ignoreSelectEcho } from "@/lib/radix-select-echo"

type Cell = string | number | null

interface SheetPreview {
  name: string
  totalRows: number
  rows: Cell[][]
}

interface PreviewUpdate {
  id: string
  codigo: string
  nombre: string
  precioCompraActual: number | null
  precioVentaActual: number | null
  precioCompraNuevo: number | null
  precioVentaNuevo: number | null
  cambia: boolean
}

interface PreviewResponse {
  summary: {
    totalRows: number
    matched: number
    sinCambios: number
    unmatched: number
    errors: number
  }
  updates: PreviewUpdate[]
  unmatched: Array<{ rowIndex: number; codigo: string; nombre: string }>
  errors: Array<{ rowIndex: number; codigo: string; message: string }>
}

const NONE_VALUE = "__none__"

type Step = "upload" | "sheet" | "mapping" | "preview"

interface ColumnMapping {
  codigo?: number
  nombre?: number
  precioCompra?: number
  precioVenta?: number
}

/**
 * Lo unico de este asistente que llega a localStorage: las DECISIONES, nunca la
 * planilla.
 *
 * La planilla llega como `File` y ademas se guarda en base64 para mandarla al
 * backend en cada paso. Ninguna de las dos puede persistirse: un `File` se
 * serializa a `{}`, y el base64 de un xlsx de hasta 6MB no entra en una cuota de
 * ~5MB que ademas comparte con todos los otros borradores del panel -- el
 * `setItem` empieza a tirar QuotaExceededError y la persistencia deja de
 * funcionar en TODO el panel, en silencio.
 *
 * El reparto es el correcto igual: volver a elegir el archivo son dos clicks,
 * volver a mapear las columnas de una lista de proveedor es la parte tediosa.
 * Por eso el borrador restaura el asistente en el paso 1 con las decisiones ya
 * tomadas, y el aviso dice que falta el archivo (ver el `detail` del aviso: un
 * "se restauro un borrador" a secas seria una promesa que este asistente no
 * puede cumplir).
 *
 * Tampoco van la vista previa ni las filas excluidas -- ver `teniaExclusiones`.
 */
interface ImportarPreciosDraft {
  selectedSheet: string
  headerRow: number
  mapping: ColumnMapping
  onlyIncrease: boolean
  motivo: string
  /**
   * Habia filas desmarcadas a mano en la vista previa anterior.
   *
   * La lista en si (`excludedIds`) es un `Set`, que se serializa a `{}`: no
   * sobrevive. Y restaurarla a medias es peor que no restaurarla -- volver a
   * incluir en un cambio masivo de precios filas que alguien saco a proposito
   * es exactamente el error que el paso de revision existe para evitar. Asi que
   * no se restaura ninguna, y esta marca es lo que le permite al aviso decirlo
   * en vez de dejar que el operador lo descubra al aplicar.
   */
  teniaExclusiones: boolean
}

/** True si el mapeo guardado todavia ENTRA en la planilla que se acaba de subir.
 *  Un indice que apunta a una columna que ya no existe no es un mapeo a medias:
 *  es un mapeo que le manda basura a la API.
 *
 *  Ojo con lo que esto NO dice: que el mapeo siga SIGNIFICANDO lo mismo. Un
 *  indice solo significa algo dentro de la hoja y la fila de encabezados con las
 *  que se eligio; movida cualquiera de las dos, los mismos numeros entran en
 *  rango igual y apuntan a otras columnas. Por eso esta funcion es la segunda
 *  condicion y nunca la unica -- ver `mapeoElegido`. */
function mapeoEntraEnLaPlanilla(mapping: ColumnMapping, columnas: number): boolean {
  const indices = [
    mapping.codigo,
    mapping.nombre,
    mapping.precioCompra,
    mapping.precioVenta,
  ].filter((i): i is number => typeof i === "number")
  if (indices.length === 0) return false
  return indices.every((i) => Number.isInteger(i) && i >= 0 && i < columnas)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(",")[1] || ""
      resolve(base64)
    }
    reader.onerror = () =>
      reject(new Error("No se pudo leer el archivo. Verificá que no esté abierto en Excel."))
    reader.readAsDataURL(file)
  })
}

function fmtPrice(v: number | null): string {
  if (v === null || v === undefined) return "—"
  return v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function deltaPct(actual: number | null, nuevo: number | null): string {
  if (actual === null || nuevo === null || actual === 0) return ""
  const pct = ((nuevo - actual) / actual) * 100
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(1)}%`
}

export default function ImportarPreciosPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>("upload")
  const [fileName, setFileName] = useState<string>("")
  const [fileBase64, setFileBase64] = useState<string>("")
  const [sheets, setSheets] = useState<SheetPreview[]>([])
  const [selectedSheet, setSelectedSheet] = useState<string>("")
  const [headerRow, setHeaderRow] = useState<number>(0)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  /**
   * El mapeo que hay en `mapping` lo eligio una persona: lo restauro el borrador
   * (donde llego porque alguien lo reviso) o lo toco a mano en el paso 3.
   *
   * Es lo que separa "este mapeo hay que respetarlo" de "estos indices quedaron
   * dando vueltas". Que entren en rango no alcanza: los indices de una hoja
   * entran en rango en casi cualquier otra, y ahi apuntan a las columnas
   * equivocadas de un cambio masivo de precios. Se apaga en cuanto cambia el
   * contexto que les da sentido -- otra hoja, otra fila de encabezados -- junto
   * con el mapeo mismo.
   */
  const [mapeoElegido, setMapeoElegido] = useState(false)
  const [onlyIncrease, setOnlyIncrease] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const sheetData = useMemo(
    () => sheets.find((s) => s.name === selectedSheet),
    [sheets, selectedSheet]
  )

  const headers = useMemo(() => {
    if (!sheetData) return []
    return sheetData.rows[headerRow] || []
  }, [sheetData, headerRow])

  // --- Borrador local (useFormDraft) ----------------------------------------
  //
  // Ver ImportarPreciosDraft para QUE se guarda y por que la planilla no.
  /** Raiz del gate de interaccion del hook. Esta pantalla no tenia ningun
   *  <form>, y el gate solo cuenta controles que pertenecen a uno (o a una capa
   *  portalada que un <form> haya abierto): sin el, elegir la hoja no marcaba
   *  nada como sucio y el borrador no se grababa nunca.
   *
   *  La fila de encabezados se elige clickeando un <tr>, que no es un control de
   *  formulario y por lo tanto NO abre el gate por si solo. No hace falta que lo
   *  haga: el paso siguiente es el boton "Continuar", que si lo abre, y a partir
   *  de ahi el snapshot incluye la fila elegida. Un operador que elige la fila y
   *  no hace nada mas no tiene todavia nada que perder. */
  const formRef = useRef<HTMLFormElement>(null)
  const [appliedDraft, setAppliedDraft] = useState<ImportarPreciosDraft | null>(null)
  const draftAppliedRef = useRef<ImportarPreciosDraft | null>(null)
  const { draft, ready: draftReady, clearDraft, notifyChange } = useFormDraft<ImportarPreciosDraft>({
    feature: "importar-precios",
    getValue: () => ({
      selectedSheet,
      headerRow,
      mapping,
      onlyIncrease,
      motivo,
      teniaExclusiones: excludedIds.size > 0,
    }),
    rootRef: formRef,
    validate: (data) => {
      const value = data as ImportarPreciosDraft
      return (
        !!value &&
        typeof value === "object" &&
        typeof value.selectedSheet === "string" &&
        typeof value.headerRow === "number" &&
        !!value.mapping &&
        typeof value.mapping === "object" &&
        typeof value.motivo === "string"
      )
    },
  })

  /** El aviso no puede sobrevivir al borrador que anuncia. */
  const draftNoticeVisible = draft !== null && appliedDraft === draft

  useEffect(() => {
    if (!draftReady || !draft || draftAppliedRef.current === draft) return
    draftAppliedRef.current = draft
    // El paso NO se restaura: sin la planilla no hay hojas que mostrar ni
    // preview que revisar, asi que cualquier paso posterior al 1 seria una
    // pantalla vacia. Las decisiones quedan cargadas esperando el archivo.
    setSelectedSheet(draft.selectedSheet)
    setHeaderRow(Number.isInteger(draft.headerRow) ? draft.headerRow : 0)
    setMapping(draft.mapping)
    // Viene con su hoja y su fila de encabezados, o sea con el contexto que le
    // da sentido: es un mapeo elegido, no indices sueltos.
    setMapeoElegido(true)
    setOnlyIncrease(draft.onlyIncrease === true)
    setMotivo(draft.motivo)
    setAppliedDraft(draft)
    notifyChange()
  }, [draftReady, draft, notifyChange])

  const reset = () => {
    setFileName("")
    setFileBase64("")
    setSheets([])
    setSelectedSheet("")
    setHeaderRow(0)
    setMapping({})
    setMapeoElegido(false)
    setOnlyIncrease(false)
    setMotivo("")
    setPreview(null)
    setExcludedIds(new Set())
    setStep("upload")
  }

  /** Cambiar de hoja o de fila de encabezados deja el mapeo sin el contexto en
   *  el que se eligio: los indices siguen entrando en rango pero ya no apuntan a
   *  las mismas columnas. Se descarta y el paso 3 vuelve a proponer uno. */
  const elegirHoja = (nombre: string) => {
    setSelectedSheet(nombre)
    setHeaderRow(0)
    setMapping({})
    setMapeoElegido(false)
  }

  const elegirFilaEncabezados = (idx: number) => {
    if (idx === headerRow) return
    setHeaderRow(idx)
    setMapping({})
    setMapeoElegido(false)
  }

  /** Un cambio a mano en el paso 3 convierte al mapeo en uno elegido: de ahi en
   *  mas el auto-detect no vuelve a pisarlo, ni siquiera pasando otra vez por el
   *  paso 2 (ver goToMapping). */
  const elegirColumna = (campo: keyof ColumnMapping, valor: string) => {
    setMapping((m) => ({
      ...m,
      [campo]: valor === NONE_VALUE ? undefined : Number(valor),
    }))
    setMapeoElegido(true)
  }

  const discardDraft = () => {
    // El aviso se apaga solo: `clearDraft` deja `draft` en null en este mismo
    // commit y de ahi se deriva (ver draftNoticeVisible).
    clearDraft()
    reset()
  }

  const handleFile = async (file: File) => {
    setLoading(true)
    try {
      const base64 = await fileToBase64(file)
      const res = await fetch("/api/inventario/precios/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: base64, mime: file.type }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "No se pudo leer el archivo")
        return
      }
      setFileName(file.name)
      setFileBase64(base64)
      setSheets(data.sheets)
      // La hoja y la fila de encabezados que venian del borrador se respetan si
      // la planilla nueva las tiene. Pisarlas con la primera hoja (que es lo
      // correcto para una subida limpia) le haria rehacer al operador las dos
      // decisiones que el borrador acaba de devolverle.
      const hojas: SheetPreview[] = data.sheets || []
      const hojaGuardada = hojas.find((s) => s.name === selectedSheet)
      if (hojaGuardada) {
        // Solo cuando la fila sigue existiendo en esa hoja: una planilla mas
        // corta dejaria el encabezado apuntando a la nada. Y si hay que moverla,
        // el mapeo pierde el contexto en el que se eligio (ver elegirHoja).
        if (headerRow >= hojaGuardada.rows.length) {
          setHeaderRow(0)
          setMapping({})
          setMapeoElegido(false)
        }
      } else {
        elegirHoja(hojas[0]?.name || "")
      }
      setStep("sheet")
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : "Error al leer el archivo")
    } finally {
      setLoading(false)
    }
  }

  const goToMapping = () => {
    if (!selectedSheet) {
      toast.error("Elegí una hoja")
      return
    }
    if (!sheetData || sheetData.rows.length <= headerRow + 1) {
      toast.error("La hoja no tiene filas de datos debajo del encabezado")
      return
    }
    // auto-detect columns by header keywords
    const hs = (sheetData.rows[headerRow] || []).map((c) =>
      String(c ?? "").toLowerCase().trim()
    )
    const detect = (regexes: RegExp[]): number | undefined => {
      for (let i = 0; i < hs.length; i++) {
        for (const r of regexes) {
          if (r.test(hs[i])) return i
        }
      }
      return undefined
    }
    // El auto-detect es una PRIMERA propuesta, no una correccion: un mapeo que
    // ELIGIO una persona -- el que restauro el borrador, o el que toco a mano en
    // el paso 3 -- es el que hay que respetar. Correrlo igual volvia a mapear
    // columnas que alguien habia desmapeado a proposito.
    //
    // Las dos condiciones, y en este orden. Preguntar solo si los indices entran
    // en rango deja pasar los que quedaron de OTRA hoja u otra fila de
    // encabezados: entran igual, y ahi "Codigo" y "Precio venta" apuntan a
    // cualquier cosa. Por eso `mapeoElegido` se apaga con el contexto que les da
    // sentido, y de esa combinacion sale un cambio masivo de precios.
    setMapping((actual) =>
      mapeoElegido && mapeoEntraEnLaPlanilla(actual, hs.length)
        ? actual
        : {
            codigo: detect([/^c[oó]digo$/i, /^codigo$/i, /^cod\.?$/i, /^sku$/i]),
            nombre: detect([/^nombre$/i, /descrip/i, /producto/i, /art[ií]culo/i]),
            precioCompra: detect([/costo/i, /compra/i, /precio.?compra/i]),
            precioVenta: detect([/venta/i, /^precio$/i, /^pvp$/i, /lista/i]),
          }
    )
    setStep("mapping")
  }

  const runPreview = async () => {
    if (mapping.codigo == null) {
      toast.error("Tenés que mapear la columna de código")
      return
    }
    if (mapping.precioCompra == null && mapping.precioVenta == null) {
      toast.error("Mapeá al menos una columna de precio")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/inventario/precios/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: fileBase64,
          sheet: selectedSheet,
          headerRow,
          mapping,
          options: { onlyIncreasePrices: onlyIncrease },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Error en la vista previa")
        return
      }
      setPreview(data)
      setExcludedIds(new Set())
      setStep("preview")
    } catch (e) {
      console.error(e)
      toast.error("Error al generar la vista previa")
    } finally {
      setLoading(false)
    }
  }

  const toggleRow = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyChanges = async () => {
    if (!preview) return
    const updates = preview.updates
      .filter((u) => u.cambia && !excludedIds.has(u.id))
      .map((u) => ({
        id: u.id,
        precioCompraNuevo: u.precioCompraNuevo,
        precioVentaNuevo: u.precioVentaNuevo,
      }))
    if (updates.length === 0) {
      toast.error("No hay cambios seleccionados")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/inventario/precios/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates, motivo: motivo.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Error al aplicar cambios")
        return
      }
      // Solo aca: los `return` de arriba (error de la API, nada seleccionado)
      // dejan el borrador donde esta.
      clearDraft()
      toast.success(`${data.updated} precio${data.updated === 1 ? "" : "s"} actualizado${data.updated === 1 ? "" : "s"}`)
      router.push("/inventario")
    } catch (e) {
      console.error(e)
      toast.error("Error al aplicar cambios")
    } finally {
      setLoading(false)
    }
  }

  const columnOptions = useMemo(() => {
    return headers.map((h, idx) => ({
      value: String(idx),
      label: `${idx + 1}. ${String(h ?? "").trim() || "(vacía)"}`,
    }))
  }, [headers])

  const cambiosCount = preview
    ? preview.updates.filter((u) => u.cambia && !excludedIds.has(u.id)).length
    : 0

  return (
    <PageShell
      title="Importar lista de precios"
      description="Subí un archivo Excel del proveedor para actualizar precios masivamente"
      icon={FileSpreadsheet}
      backHref="/inventario"
    >
      {/*
        El <form> no envia nada -- cada paso avanza con su propio boton y
        `onSubmit` corta un Enter accidental antes de que el navegador navegue.
        Existe porque el gate de interaccion de useFormDraft solo cuenta
        controles que pertenecen a un <form> (o a una capa portalada que un
        <form> haya abierto, como el listado de un Select): sin esto, elegir la
        hoja o la fila de encabezados no marcaba nada como sucio.
      */}
      <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="contents">
      {draftNoticeVisible && (
        <DraftRestoredNotice
          onDiscard={discardDraft}
          detail={
            <>
              El archivo no se guarda en el borrador: volvé a subirlo. Se conservan la hoja,
              la fila de encabezados, el mapeo de columnas y las opciones.
              {appliedDraft?.teniaExclusiones
                ? " Las filas que desmarcaste en la vista previa anterior no vuelven: revisalas de nuevo antes de aplicar."
                : ""}
            </>
          }
        />
      )}

      <div className="flex gap-2 text-xs">
        {(["upload", "sheet", "mapping", "preview"] as Step[]).map((s, idx) => {
          const active = s === step
          const done =
            (["upload", "sheet", "mapping", "preview"] as Step[]).indexOf(step) > idx
          const label = ["1. Archivo", "2. Hoja", "3. Columnas", "4. Revisar"][idx]
          return (
            <div
              key={s}
              className={`px-3 py-1.5 rounded-full border ${
                active
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : done
                    ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
                    : "border-muted text-muted-foreground"
              }`}
            >
              {label}
            </div>
          )
        })}
      </div>

      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Subir archivo Excel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="border-2 border-dashed border-muted rounded-lg p-8 text-center cursor-pointer hover:border-primary transition"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="font-medium">Hacé click o arrastrá un archivo</p>
              <p className="text-sm text-muted-foreground mt-1">
                Formato .xlsx — máximo 6MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  // Limpiar el value: sin esto, re-elegir el MISMO archivo no
                  // dispara change y el reintento queda en silencio.
                  e.target.value = ""
                  if (f) handleFile(f)
                }}
              />
            </div>
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Procesando archivo...
              </div>
            )}
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="font-medium mb-1">Cómo funciona</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Solo se actualizan productos existentes (match por <strong>código interno</strong>)</li>
                <li>Productos no encontrados se listan, no se crean</li>
                <li>Los cambios se registran en el historial de precios</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "sheet" && sheetData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Hoja y fila de encabezados</span>
              <span className="text-sm font-normal text-muted-foreground">{fileName}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Hoja</Label>
                <Select
                  value={selectedSheet}
                  onValueChange={ignoreSelectEcho(elegirHoja)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (
                      <SelectItem key={s.name} value={s.name}>
                        {s.name} ({s.totalRows} filas)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fila de encabezados</Label>
                <p className="text-xs text-muted-foreground mb-1">
                  Hacé click en la fila que contiene los nombres de columnas
                </p>
              </div>
            </div>

            <div className="border rounded-md overflow-auto max-h-96">
              <table className="text-xs w-full">
                <tbody>
                  {sheetData.rows.map((row, idx) => {
                    const isHeader = idx === headerRow
                    return (
                      <tr
                        key={idx}
                        onClick={() => elegirFilaEncabezados(idx)}
                        className={`cursor-pointer border-b ${
                          isHeader
                            ? "bg-primary/15 font-semibold"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <td className="px-2 py-1 text-muted-foreground tabular-nums w-10">
                          {idx + 1}
                        </td>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-2 py-1 whitespace-nowrap max-w-[200px] truncate">
                            {cell === null || cell === undefined ? "" : String(cell)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={reset}>
                Cambiar archivo
              </Button>
              <Button type="button" onClick={goToMapping}>Continuar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "mapping" && sheetData && (
        <Card>
          <CardHeader>
            <CardTitle>Mapear columnas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Indicá qué columna del Excel corresponde a cada campo. <strong>Código</strong> es obligatorio. Mapeá al menos un precio.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Código <span className="text-red-500">*</span></Label>
                <Select
                  value={mapping.codigo != null ? String(mapping.codigo) : NONE_VALUE}
                  onValueChange={ignoreSelectEcho((v) => elegirColumna("codigo", v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí columna..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>— sin mapear —</SelectItem>
                    {columnOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Nombre (informativo)</Label>
                <Select
                  value={mapping.nombre != null ? String(mapping.nombre) : NONE_VALUE}
                  onValueChange={ignoreSelectEcho((v) => elegirColumna("nombre", v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí columna..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>— sin mapear —</SelectItem>
                    {columnOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Precio compra / costo</Label>
                <Select
                  value={mapping.precioCompra != null ? String(mapping.precioCompra) : NONE_VALUE}
                  onValueChange={ignoreSelectEcho((v) => elegirColumna("precioCompra", v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí columna..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>— sin mapear —</SelectItem>
                    {columnOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Precio venta</Label>
                <Select
                  value={mapping.precioVenta != null ? String(mapping.precioVenta) : NONE_VALUE}
                  onValueChange={ignoreSelectEcho((v) => elegirColumna("precioVenta", v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí columna..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>— sin mapear —</SelectItem>
                    {columnOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Switch checked={onlyIncrease} onCheckedChange={setOnlyIncrease} id="only-increase" />
              <Label htmlFor="only-increase" className="cursor-pointer">
                Solo aumentar precios (ignorar bajas)
              </Label>
            </div>

            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setStep("sheet")}>
                Atrás
              </Button>
              <Button type="button" onClick={runPreview} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Ver cambios
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Filas leídas</p>
                <p className="text-2xl font-bold">{preview.summary.totalRows}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Cambios</p>
                <p className="text-2xl font-bold text-green-600">{preview.summary.matched}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">No encontrados</p>
                <p className="text-2xl font-bold text-orange-500">{preview.summary.unmatched}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Errores</p>
                <p className="text-2xl font-bold text-red-500">{preview.summary.errors}</p>
              </CardContent>
            </Card>
          </div>

          {preview.updates.filter((u) => u.cambia).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cambios a aplicar</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left w-8"></th>
                        <th className="px-3 py-2 text-left">Código</th>
                        <th className="px-3 py-2 text-left">Producto</th>
                        <th className="px-3 py-2 text-right">Costo actual</th>
                        <th className="px-3 py-2 text-right">Costo nuevo</th>
                        <th className="px-3 py-2 text-right">Venta actual</th>
                        <th className="px-3 py-2 text-right">Venta nueva</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.updates
                        .filter((u) => u.cambia)
                        .map((u) => {
                          const excluded = excludedIds.has(u.id)
                          return (
                            <tr
                              key={u.id}
                              className={`border-t ${excluded ? "opacity-40" : ""}`}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={!excluded}
                                  onChange={() => toggleRow(u.id)}
                                />
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{u.codigo}</td>
                              <td className="px-3 py-2">{u.nombre}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {fmtPrice(u.precioCompraActual)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {u.precioCompraNuevo != null ? (
                                  <span>
                                    {fmtPrice(u.precioCompraNuevo)}
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      {deltaPct(u.precioCompraActual, u.precioCompraNuevo)}
                                    </span>
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {fmtPrice(u.precioVentaActual)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {u.precioVentaNuevo != null ? (
                                  <span>
                                    {fmtPrice(u.precioVentaNuevo)}
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      {deltaPct(u.precioVentaActual, u.precioVentaNuevo)}
                                    </span>
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {preview.unmatched.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  No encontrados ({preview.unmatched.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-2">
                  Estos códigos no existen en el inventario y se ignorarán:
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
                  {preview.unmatched.slice(0, 100).map((u, i) => (
                    <Badge key={i} variant="secondary" className="font-mono text-xs">
                      {u.codigo}
                    </Badge>
                  ))}
                  {preview.unmatched.length > 100 && (
                    <span className="text-xs text-muted-foreground self-center">
                      y {preview.unmatched.length - 100} más...
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {preview.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-red-500">
                  <X className="h-4 w-4" />
                  Errores ({preview.errors.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1 max-h-40 overflow-auto">
                  {preview.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">Fila {e.rowIndex + headerRow + 2}</span>
                      {e.codigo ? <span className="ml-1 font-mono text-xs">[{e.codigo}]</span> : null}
                      <span className="ml-2 text-red-600 dark:text-red-400">{e.message}</span>
                    </li>
                  ))}
                  {preview.errors.length > 50 && (
                    <li className="text-xs text-muted-foreground">
                      y {preview.errors.length - 50} más...
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 space-y-3">
              <div>
                <Label htmlFor="motivo">Motivo (opcional)</Label>
                <Input
                  id="motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: Lista de precios proveedor X — abril 2026"
                  maxLength={200}
                />
              </div>
              <div className="flex justify-between">
                <Button type="button" variant="outline" onClick={() => setStep("mapping")}>
                  Atrás
                </Button>
                <Button type="button" onClick={applyChanges} disabled={loading || cambiosCount === 0}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  Aplicar {cambiosCount} cambio{cambiosCount === 1 ? "" : "s"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      </form>
    </PageShell>
  )
}
