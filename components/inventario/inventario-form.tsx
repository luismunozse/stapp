"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FormActionBar } from "@/components/ui/form-action-bar"
import { DraftRestoredNotice, RecordChangedNotice } from "@/components/ui/draft-restored-notice"
import { X, ChevronDown, ChevronUp, Plus, Check, Loader2, ImagePlus, Trash2, Package, AlertTriangle, PlusCircle, Pencil, MapPin } from "lucide-react"
import type { Inventario } from "@/types"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import { compressImage } from "@/lib/image-compression"
import { parseMoneyInput } from "@/lib/parse-money"
import { validateBarcode, computeEAN13CheckDigit } from "@/lib/barcode-validation"
import useSWR from "swr"
import { useModal } from "@/contexts/modal-context"
import { useFormDraft, fingerprintRecord } from "@/hooks/use-form-draft"

interface ProveedorLite {
  id: string
  nombre: string
  activo?: boolean
}

interface DuplicateMatch {
  id: string
  codigo: string
  nombre: string
  categoria: string
  tipoDispositivo: string
  stock: number
  precioCompra: number
  precioVenta: number
  proveedor: string | null
  score: number
}

const proveedoresFetcher = async (url: string): Promise<ProveedorLite[]> => {
  // El endpoint puede devolver `{error: ...}` (401, 500, etc). Sin guard,
  // SWR setea data = objeto y .filter()/.map() rompen en runtime.
  const res = await fetch(url)
  const data = await res.json().catch(() => null)
  return Array.isArray(data) ? data : []
}

const inventarioSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  categoria: z.string().min(1, "La categoría es requerida"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  stock: z.number().int().min(0),
  precioCompra: z.number().min(0),
  precioVenta: z.number().min(0),
  proveedorId: z.string().min(1).nullable().optional(),
  stockMinimo: z.number().int().min(0).nullable().optional(),
  stockMaximo: z.number().int().min(0).nullable().optional(),
  puntoReorden: z.number().int().min(0).nullable().optional(),
  ubicacion: z.string().max(200, "Máximo 200 caracteres").nullable().optional(),
  // Validación de checksum NO bloquea: el form muestra sugerencia inline
  // (ver bloque debajo del input). Códigos internos / impresos sin checksum
  // estricto deben poder guardarse igual; bloquearlos fue causa de "no se
  // registran EAN-13" en codes genéricos no-GS1.
  barcode: z.string().nullable().optional(),
  diasGarantiaDefault: z.number().int().min(0).nullable().optional(),
  trackeaLotes: z.boolean().optional(),
  trackeaSeries: z.boolean().optional(),
  tieneVariantes: z.boolean().optional(),
  esKit: z.boolean().optional(),
  tipoKit: z.enum(["ENSAMBLADO", "VIRTUAL"]).nullable().optional(),
})

type InventarioFormData = z.infer<typeof inventarioSchema>

/**
 * Valores base del formulario: prefill de edicion, o blanco (con el barcode del
 * scanner, si vino uno) para el alta.
 *
 * Vive afuera del componente y en UNA sola funcion a proposito. Es la base del
 * `useForm`, del reset de edicion, del descarte de borrador y del token de
 * frescura que compara este formulario contra el registro (`fingerprintRecord`,
 * mas abajo): mientras las cuatro cosas salgan de aca, agregar un campo al
 * formulario lo agrega a las cuatro y no pueden separarse.
 */
function inventarioFormDefaults(
  item?: Inventario | null,
  initialBarcode?: string | null
): InventarioFormData {
  return item
    ? {
        nombre: item.nombre,
        categoria: item.categoria,
        tipoDispositivo: item.tipoDispositivo,
        stock: item.stock,
        // precioCompra viene en null cuando la fuente no expuso el costo. El
        // input necesita un número, así que arranca en 0 — pero ese 0 no se
        // envía: onSubmit omite el campo del payload cuando el item cargó
        // sin costo (ver `costoCargado`).
        precioCompra: item.precioCompra ?? 0,
        precioVenta: item.precioVenta,
        proveedorId: item.proveedorId ?? null,
        stockMinimo: item.stockMinimo ?? null,
        stockMaximo: item.stockMaximo ?? null,
        puntoReorden: item.puntoReorden ?? null,
        barcode: item.barcode ?? null,
        diasGarantiaDefault: (item as any).diasGarantiaDefault ?? null,
        ubicacion: item.ubicacion ?? null,
        trackeaLotes: item.trackeaLotes ?? false,
        trackeaSeries: item.trackeaSeries ?? false,
        tieneVariantes: item.tieneVariantes ?? false,
        esKit: item.esKit ?? false,
        tipoKit: item.tipoKit ?? null,
      }
    : {
        nombre: "",
        categoria: "",
        tipoDispositivo: "",
        stock: 0,
        precioCompra: 0,
        precioVenta: 0,
        proveedorId: null,
        stockMinimo: null,
        stockMaximo: null,
        puntoReorden: null,
        barcode: initialBarcode ?? null,
        diasGarantiaDefault: null,
        ubicacion: null,
        trackeaLotes: false,
        trackeaSeries: false,
        tieneVariantes: false,
        esKit: false,
        tipoKit: null,
      }
}

/**
 * Estado del formulario que NO vive en react-hook-form y que igual es trabajo
 * escrito: los inputs inline de "nuevo tipo" / "nueva categoria" (texto que el
 * operador ya tipeo y que todavia no existe en el servidor) y el panel de
 * umbrales de stock, que se abre a mano.
 *
 * Un snapshot de `getValues()` a secas los tira en silencio: el borrador
 * volveria "restaurado" con el panel cerrado y el tipo a medio crear perdido,
 * que es justo la parte que cuesta volver a cargar.
 */
interface InventarioDraftUi {
  showStockConfig: boolean
  showNewTipo: boolean
  newTipo: string
  showNewCategoria: boolean
  newCategoria: string
  /** Habia una imagen elegida sin subir. El `File` NO se persiste (ver el
   *  snapshot del hook, mas abajo): esto es solo la marca que le permite al
   *  aviso decir que hay que volver a elegirla. */
  imagenPendiente: boolean
}

/**
 * Lo unico de este formulario que llega a localStorage.
 *
 * Los campos de react-hook-form van SEPARADOS del estado de UI y no mezclados
 * en un objeto plano: el submit spreadea los valores del formulario dentro del
 * payload (`{ ...rest }` en onSubmit), asi que una clave de UI que se cuele en
 * ese nivel viaja al POST/PUT. Con el corte hecho por tipo, `reset()` recibe
 * `values` y nada mas, y agregar una clave de UI manana no puede terminar en la
 * API por olvido.
 */
interface InventarioDraftValue {
  values: InventarioFormData
  ui: InventarioDraftUi
}

// Categorías específicas por tipo de dispositivo
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

interface InventarioFormProps {
  item?: Inventario | null
  // Barcode pre-cargado (p.ej. desde scanner cuando se crea un item nuevo)
  initialBarcode?: string | null
  onClose: () => void
  onSuccess: () => void
  // Disparado al pedir editar un duplicado detectado. El padre debe cargar
  // ese item y reabrir el form en modo edición.
  onEditExisting?: (id: string) => void
}

export function InventarioForm({
  item,
  initialBarcode,
  onClose,
  onSuccess,
  onEditExisting,
}: InventarioFormProps) {
  const { showError, showWarning, confirm } = useModal()
  const { tipos: tiposDispositivo, loading: tiposLoading, error: tiposError, refetch: refetchTipos } = useTiposDispositivo({ incluirTodos: true })
  const [loading, setLoading] = useState(false)
  const [generatedCode, setGeneratedCode] = useState<string>("")
  const [showStockConfig, setShowStockConfig] = useState(
    !!(item?.stockMinimo || item?.stockMaximo || item?.puntoReorden)
  )
  const [showNewCategoria, setShowNewCategoria] = useState(false)
  const [newCategoria, setNewCategoria] = useState("")
  const [savingCategoria, setSavingCategoria] = useState(false)
  const [showNewTipo, setShowNewTipo] = useState(false)
  const [newTipo, setNewTipo] = useState("")
  const [savingTipo, setSavingTipo] = useState(false)

  // Imagen: el estado vive fuera de react-hook-form porque es multipart upload.
  // `imagenPreview` muestra preview inmediato; `pendingFile` es lo que se sube al submit.
  const [imagenPreview, setImagenPreview] = useState<string | null>(item?.imagenUrl || null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [removeExistingImage, setRemoveExistingImage] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Proveedores
  const { data: proveedores = [] } = useSWR<ProveedorLite[]>("/api/proveedores", proveedoresFetcher, {
    revalidateOnFocus: false,
  })

  // Detección de duplicados (solo alta nueva): nombre normalizado + mismo tipo + misma categoría.
  // Señal suave; el usuario decide si consolidar, editar el existente o crear igual.
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  const [consolidating, setConsolidating] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    watch,
    getValues,
    setValue,
  } = useForm<InventarioFormData>({
    resolver: zodResolver(inventarioSchema),
    defaultValues: inventarioFormDefaults(item, initialBarcode),
  })

  const categoria = watch("categoria")
  const tipoDispositivo = watch("tipoDispositivo")

  /**
   * Descarta el "" que devuelve el <select> oculto de Radix, y deja pasar todo
   * lo demas.
   *
   * Radix monta un <select> nativo invisible al lado de cada trigger para que el
   * formulario tenga un control real (SelectBubbleInput, en
   * @radix-ui/react-select). Cuando el valor cambia DESDE AFUERA, ese componente
   * hace `select.value = nuevo` y dispara un `change` a mano. Las <option> de
   * ese select las registran los <SelectItem>, que solo estan montados mientras
   * el listado esta abierto: con el listado cerrado no hay ninguna opcion,
   * asignarle un valor que no existe lo deja en "" y el `change` devuelve ese ""
   * por `onValueChange`. El formulario se pisa el campo que acaba de setear.
   *
   * Nadie lo habia notado porque el resto de los caminos que setean estos campos
   * por codigo lo hacen con el Select DESMONTADO ("Agregar tipo" / "Agregar
   * categoria" lo reemplazan por un input inline) o con el valor ya puesto en
   * `defaultValues`, o sea antes de que exista un valor anterior con el cual
   * comparar. Restaurar un borrador es el primer caso que cambia el valor de un
   * Select montado: sin esto, el borrador volvia con Tipo y Categoria en blanco
   * -- los dos campos obligatorios que ademas gatillan la generacion del codigo,
   * asi que "Guardar" quedaba deshabilitado sin nada en pantalla que lo
   * explicara.
   *
   * Un "" nunca puede venir de una eleccion real: Radix rechaza un SelectItem
   * con `value=""`. Por eso alcanza con ignorarlo para separar el eco del
   * control oculto de lo que hizo el operador.
   */
  const onSelectValueChange = (apply: (value: string) => void) => (value: string) => {
    if (!value) return
    apply(value)
  }

  // ¿La fuente expuso el costo de este item? Un item nuevo no tiene costo
  // previo que proteger, así que su 0 es un valor real. Un item cargado con
  // `precioCompra: null` llega sin costo porque el rol no puede verlo.
  //
  // Manda sobre el input y sobre el payload a la vez: si no se muestra, no se
  // manda (ver onSubmit). Antes vivía sólo en onSubmit, y el input se pintaba
  // igual sembrado en 0 — un costo inventado a la vista del operador.
  const costoCargado = !item || (item.precioCompra !== null && item.precioCompra !== undefined)

  // --- Borrador local (useFormDraft) ----------------------------------------
  //
  // Este formulario tiene ~20 campos que se cargan a mano y hasta ahora se
  // perdian enteros: un vencimiento de sesion, un click en el menu o el cierre
  // de la pestana los borraba sin dejar rastro.
  //
  // Tres particularidades frente a los otros tres call sites del hook:
  //
  //  1. La IMAGEN no se persiste. Vive fuera de react-hook-form porque es un
  //     upload multipart (ver el bloque de estado mas arriba) y es un `File`:
  //     `JSON.stringify` lo convierte en `{}`, y guardar su base64 en su lugar
  //     seria meter hasta varios MB en una cuota de ~5MB que ademas comparte
  //     con todos los otros borradores -- el `setItem` empieza a tirar
  //     QuotaExceededError y la persistencia deja de funcionar EN TODO EL
  //     PANEL, en silencio. Se guarda solo la marca `imagenPendiente` y el
  //     aviso le dice al operador que la vuelva a elegir.
  //
  //  2. El resto del estado de afuera de RHF SI se persiste (`InventarioDraftUi`).
  //
  //  3. `enabled` no hace falta: inventario-list monta este Card dentro de
  //     `{showForm && ...}`, o sea que desmonta de verdad al cerrar -- a
  //     diferencia de los dialogs, que quedan montados con `open=false`.
  const recordId = item?.id ?? null
  /** Huella de los campos que ESTE formulario edita, sobre la misma funcion que
   *  arma el prefill. `Inventario` no expone `updatedAt`, pero aunque lo
   *  expusiera no serviria: la fila se escribe en cada venta, cada recepcion y
   *  cada ajuste de stock, o sea que el token se moveria por trabajo de
   *  mostrador rutinario y borraria el borrador de quien tuviera la ficha
   *  abierta (ver la advertencia de `recordVersion` en el hook). */
  const itemRecordVersion = item ? fingerprintRecord(inventarioFormDefaults(item)) : null
  /** El borrador que este formulario efectivamente aplico. De aca se DERIVA el
   *  aviso (`draftNoticeVisible`) en vez de tener un booleano aparte que haya
   *  que apagar en cada camino de baja: `clearDraft` deja `draft` en null en
   *  todos ellos. Mismo criterio que los otros tres call sites. */
  const [appliedDraft, setAppliedDraft] = useState<InventarioDraftValue | null>(null)
  /** Latch POR IDENTIDAD del objeto, no por scope: el scope cambia en el render
   *  y `draft` recien en el commit siguiente, asi que una marca por `recordId`
   *  se adelanta al hook y aplica el borrador del registro anterior. */
  const draftAppliedRef = useRef<InventarioDraftValue | null>(null)
  /** Raiz del formulario para el gate de interaccion del hook. */
  const formRef = useRef<HTMLFormElement>(null)
  const {
    draft,
    ready: draftReady,
    clearDraft,
    notifyChange,
    recordChangedWhileEditing,
  } = useFormDraft<InventarioDraftValue>({
    feature: "inventario-form",
    // En alta no hay id (el registro todavia no existe) y `generatedCode`
    // tampoco sirve de key: lo devuelve el servidor y cambia con la categoria y
    // el tipo, o sea que se movería mientras el operador carga. Queda UNA
    // entrada de "producto nuevo" por usuario, igual que el alta de ordenes.
    recordId,
    getValue: () => ({
      // `getValues()` y no `watch()`: leer el form entero en render suscribe el
      // componente a cada tecla y el borrador no necesita re-renderizar nada.
      values: getValues(),
      ui: {
        showStockConfig,
        showNewTipo,
        newTipo,
        showNewCategoria,
        newCategoria,
        // LIMITE DE PERSISTENCIA: la marca, nunca el archivo (ver punto 1).
        imagenPendiente: pendingFile !== null,
      },
    }),
    rootRef: formRef,
    // `reset()` no tira excepcion con un borrador de otra forma: aplica lo que
    // le den. Un borrador de hasta 7 dias escrito por una version anterior de
    // este formulario abriria la pantalla con basura, en silencio, y esos
    // valores saldrian tal cual en el POST/PUT.
    validate: (data) => {
      const value = data as InventarioDraftValue
      return (
        !!value &&
        typeof value === "object" &&
        !!value.values &&
        typeof value.values === "object" &&
        typeof value.values.nombre === "string" &&
        typeof value.values.categoria === "string" &&
        typeof value.values.tipoDispositivo === "string" &&
        !!value.ui &&
        typeof value.ui === "object"
      )
    },
    // En edicion el PUT manda el item entero, asi que restaurar un borrador
    // viejo encima de un registro que otro operador ya guardo lo pisaria.
    recordVersion: itemRecordVersion,
  })

  /** El aviso no puede sobrevivir al borrador que anuncia. */
  const draftNoticeVisible = draft !== null && appliedDraft === draft

  // Categorías disponibles según el tipo seleccionado
  // Prioritize dynamic categories from device type config, fallback to hardcoded map
  const categoriasDisponibles = (() => {
    if (!tipoDispositivo) return []
    const tipoConfig = tiposDispositivo.find(t => t.codigo === tipoDispositivo)
    const dynamicCats = tipoConfig?.config?.categoriasInventario
    if (dynamicCats && dynamicCats.length > 0) return dynamicCats
    return categoriasPorTipo[tipoDispositivo] || categoriasPorTipo.TODOS
  })()

  // Limpiar categoría cuando cambia el tipo
  useEffect(() => {
    if (tipoDispositivo && categoria && !categoriasDisponibles.includes(categoria)) {
      setValue("categoria", "")
    }
  }, [tipoDispositivo, categoria, categoriasDisponibles, setValue])

  // Generar código automáticamente para items nuevos.
  // Usado también en el reintento de submit cuando hay colisión de código.
  const fetchCode = useCallback(async (cat: string, tipo: string, signal?: AbortSignal) => {
    if (!cat || !tipo || item) return
    try {
      const params = new URLSearchParams({ categoria: cat, tipoDispositivo: tipo })
      const res = await fetch(`/api/inventario/next-code?${params}`, { signal })
      if (res.ok) {
        const data = await res.json()
        if (data.codigo) {
          setGeneratedCode(data.codigo)
        }
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return
      console.error("Error fetching code:", error)
    }
  }, [item])

  // Debounce + abort: cambios rápidos de tipo/categoría no disparan N requests.
  useEffect(() => {
    if (item || !categoria || !tipoDispositivo) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetchCode(categoria, tipoDispositivo, controller.signal)
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [categoria, tipoDispositivo, item, fetchCode])

  useEffect(() => {
    if (item) {
      reset(inventarioFormDefaults(item))
      setImagenPreview(item.imagenUrl || null)
      setPendingFile(null)
      setRemoveExistingImage(false)
    }
  }, [item, reset])

  // Los cambios de react-hook-form no re-renderizan el componente para los
  // campos que nadie observa (stock, precios, ubicacion, umbrales...), asi que
  // hay que avisarle al borrador por suscripcion o dejarian de programar
  // grabados.
  useEffect(() => {
    const subscription = watch(() => notifyChange())
    return () => subscription.unsubscribe()
  }, [watch, notifyChange])

  // Pre-fill barcode from scanner.
  // - Item nuevo: setea siempre.
  // - Item existente: setea solo si barcode está vacío (caso scanner matcheó
  //   por codigo y queremos persistir el EAN para próximos escaneos).
  useEffect(() => {
    if (!initialBarcode) return
    if (!item) {
      setValue("barcode", initialBarcode, { shouldDirty: true, shouldTouch: true })
    } else if (!item.barcode) {
      setValue("barcode", initialBarcode, { shouldDirty: true, shouldTouch: true })
    }
  }, [item, initialBarcode, setValue])

  // Aplicacion del borrador. Declarado DESPUES del prefill de edicion y del
  // pre-cargado del scanner, que es lo que le da al borrador la ultima palabra
  // sobre esos mismos campos.
  useEffect(() => {
    // El latch se toca DESPUES de saber que hay algo que aplicar: marcarlo antes
    // deja el formulario "con el borrador ya aplicado" sin haberlo aplicado, y
    // un borrador que aparezca despues (otra pestana escribiendo la misma key)
    // se cuenta como restaurado, se pisa en silencio y el aviso no sale nunca.
    if (!draftReady || !draft || draftAppliedRef.current === draft) return
    draftAppliedRef.current = draft
    try {
      // Encima del prefill, no en su lugar: si manana la proyeccion deja algun
      // campo afuera, aplicar el borrador tal cual lo pondria en blanco y el PUT
      // manda el item entero.
      reset({ ...inventarioFormDefaults(item, initialBarcode), ...draft.values })
      setShowStockConfig(draft.ui?.showStockConfig === true)
      setShowNewTipo(draft.ui?.showNewTipo === true)
      setNewTipo(typeof draft.ui?.newTipo === "string" ? draft.ui.newTipo : "")
      setShowNewCategoria(draft.ui?.showNewCategoria === true)
      setNewCategoria(typeof draft.ui?.newCategoria === "string" ? draft.ui.newCategoria : "")
      setAppliedDraft(draft)
    } catch (error) {
      // Un borrador de otra forma no puede tumbar la pantalla: la excepcion
      // correria dentro de un efecto y se llevaria el arbol entero.
      console.error("Borrador de inventario invalido, se descarta:", error)
      clearDraft()
      setAppliedDraft(null)
      reset(inventarioFormDefaults(item, initialBarcode))
    }
    // `item`/`initialBarcode` se leen adentro (base del prefill) pero no van en
    // las dependencias: el efecto corre por borrador nuevo y ahi lee el render
    // en curso, que es el que corresponde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftReady, draft, reset, clearDraft])

  /** Vuelve el formulario ENTERO al estado base -- incluido lo que vive fuera de
   *  react-hook-form. Resetear solo RHF dejaba el input de "nuevo tipo" abierto
   *  con el texto del borrador que se acababa de descartar. */
  const discardDraft = () => {
    // El aviso se apaga solo: `clearDraft` deja `draft` en null en este mismo
    // commit y de ahi se deriva (ver draftNoticeVisible).
    clearDraft()
    reset(inventarioFormDefaults(item, initialBarcode))
    setShowStockConfig(!!(item?.stockMinimo || item?.stockMaximo || item?.puntoReorden))
    setShowNewTipo(false)
    setNewTipo("")
    setShowNewCategoria(false)
    setNewCategoria("")
    setPendingFile(null)
    setImagenPreview(item?.imagenUrl || null)
    setRemoveExistingImage(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Duplicate detection — dispara on blur del nombre (cuando el usuario pasa
  // al siguiente input). Fuzzy match por tokens en el backend; tipo/categoría
  // son filtros opcionales que acotan si están presentes.
  const nombre = watch("nombre")
  const checkDuplicates = useCallback(async () => {
    if (item) return
    const trimmed = (nombre || "").trim()
    if (trimmed.length < 2) {
      setDuplicates([])
      return
    }
    try {
      const params = new URLSearchParams({ nombre: trimmed })
      if (tipoDispositivo) params.set("tipo", tipoDispositivo)
      if (categoria) params.set("categoria", categoria)
      const res = await fetch(`/api/inventario/check-duplicate?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setDuplicates(data.matches || [])
    } catch { /* network error */ }
  }, [nombre, tipoDispositivo, categoria, item])

  // Si el usuario sigue escribiendo tras ver el aviso, limpiamos el warning
  // para evitar mostrar matches desactualizados.
  useEffect(() => {
    setDuplicates([])
  }, [nombre])

  // Sumar stock del item nuevo al existente y cerrar el formulario.
  // Genera un movimiento ENTRADA con referenciaTipo=CONSOLIDACION para trazabilidad.
  const handleConsolidate = async (match: DuplicateMatch) => {
    const values = watch()
    const stockToAdd = Number(values.stock) || 0
    if (stockToAdd <= 0) {
      await showError("Ingresá una cantidad de stock mayor a 0 para sumar al existente.")
      return
    }
    setConsolidating(match.id)
    try {
      const res = await fetch(`/api/inventario/${match.id}/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "delta",
          value: stockToAdd,
          tipo: "ENTRADA",
          referenciaTipo: "CONSOLIDACION",
          motivo: `Consolidación desde alta duplicada (${values.nombre})`,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Error al sumar stock")
      }
      // El alta se consumio: el stock que se estaba cargando ya entro contra el
      // item existente. Dejar el borrador vivo reabriria "Nuevo Item" con ese
      // mismo producto y el operador lo cargaria dos veces.
      clearDraft()
      onSuccess()
    } catch (err) {
      console.error("Error consolidando stock:", err)
      await showError(err instanceof Error ? err.message : "Error al sumar stock")
    } finally {
      setConsolidating(null)
    }
  }

  // Abrir el duplicado existente reemplaza este formulario: el padre carga ese
  // item y lo pasa como `item`, lo que dispara el reset() de más arriba y pisa
  // todos los campos cargados para el producto nuevo. El aviso de duplicados
  // aparece justo después de escribir el nombre, o sea con trabajo en pantalla
  // por definición.
  //
  // Ya no es irreversible: al mover `item` de null a un objeto cambia la key del
  // borrador (`new` -> `edit:{id}`) y el hook vuelca lo pendiente ANTES de
  // cambiarla, asi que lo cargado para el producto nuevo queda en su propia
  // entrada y vuelve solo al reabrir "Nuevo Item". La confirmación se queda
  // igual —la pantalla cambia debajo de la mano y eso se avisa— pero dice lo que
  // realmente pasa: prometer una pérdida que no ocurre es tan malo como
  // ocultarla, porque enseña a desconfiar del resto de los avisos.
  const handleEditExisting = async (match: DuplicateMatch) => {
    if (!onEditExisting) return
    const hayTrabajoSinGuardar = isDirty || pendingFile !== null
    if (hayTrabajoSinGuardar) {
      const confirmado = await confirm({
        title: "Abrir el producto existente",
        description:
          `Se va a cargar "${match.nombre}" en este formulario. Lo que cargaste para el producto nuevo queda guardado como borrador y vuelve al abrir "Nuevo Item"` +
          (pendingFile ? ", salvo la foto, que hay que elegir de nuevo." : "."),
        confirmText: "Abrir el existente",
        cancelText: "Seguir con el nuevo",
      })
      if (!confirmado) return
    }
    onEditExisting(match.id)
  }

  const handleAddTipo = async () => {
    const nombre = newTipo.trim()
    if (!nombre) return

    // Check if already exists
    const existing = tiposDispositivo.find(t => t.nombre.toLowerCase() === nombre.toLowerCase())
    if (existing) {
      setValue("tipoDispositivo", existing.codigo, { shouldValidate: true, shouldDirty: true })
      setShowNewTipo(false)
      setNewTipo("")
      return
    }

    setSavingTipo(true)
    try {
      // Generate codigo and prefijo from name
      const codigo = nombre
        .toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z0-9]/g, "_")
        .substring(0, 20)
      const prefijoOrden = nombre
        .toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z0-9]/g, "")
        .substring(0, 3)

      const res = await fetch("/api/tipos-dispositivo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, nombre, prefijoOrden: prefijoOrden || "OTR" }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Error al crear tipo")
      }

      await refetchTipos()
      setValue("tipoDispositivo", codigo, { shouldValidate: true, shouldDirty: true })
      setShowNewTipo(false)
      setNewTipo("")
    } catch (error) {
      console.error("Error adding device type:", error)
      await showError(error instanceof Error ? error.message : "Error al agregar tipo")
    } finally {
      setSavingTipo(false)
    }
  }

  const handleAddCategoria = async () => {
    const nombre = newCategoria.trim()
    if (!nombre || !tipoDispositivo) return
    if (categoriasDisponibles.includes(nombre)) {
      setValue("categoria", nombre, { shouldValidate: true, shouldDirty: true })
      setShowNewCategoria(false)
      setNewCategoria("")
      return
    }

    setSavingCategoria(true)
    try {
      const tipo = tiposDispositivo.find(t => t.codigo === tipoDispositivo)
      if (!tipo) return

      const currentCats = tipo.config?.categoriasInventario || [...(categoriasPorTipo[tipoDispositivo] || categoriasPorTipo.TODOS)]
      const updatedConfig = {
        ...tipo.config,
        categoriasInventario: [...currentCats, nombre],
      }

      const res = await fetch(`/api/tipos-dispositivo/${tipo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: updatedConfig }),
      })

      if (!res.ok) throw new Error("Error al guardar categoría")

      await refetchTipos()
      setValue("categoria", nombre, { shouldValidate: true, shouldDirty: true })
      setShowNewCategoria(false)
      setNewCategoria("")
    } catch (error) {
      console.error("Error adding category:", error)
      await showError("Error al agregar categoría")
    } finally {
      setSavingCategoria(false)
    }
  }

  const handleImagePick = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      await showError("Seleccioná una imagen válida (JPG, PNG o WebP)")
      return
    }
    try {
      const compressed = await compressImage(file)
      setPendingFile(compressed)
      setRemoveExistingImage(false)
      const reader = new FileReader()
      reader.onloadend = () => setImagenPreview(reader.result as string)
      reader.readAsDataURL(compressed)
    } catch (err) {
      console.error("Error comprimiendo imagen:", err)
      await showError("Error al procesar la imagen")
    }
  }

  const handleImageRemove = () => {
    setPendingFile(null)
    setImagenPreview(null)
    setRemoveExistingImage(!!item?.imagenUrl)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Sube la imagen pendiente (si hay) al endpoint dedicado. Requiere itemId.
  const uploadPendingImage = async (itemId: string) => {
    if (!pendingFile) return
    setUploadingImage(true)
    try {
      const formData = new FormData()
      formData.append("file", pendingFile)
      const res = await fetch(`/api/inventario/${itemId}/imagen`, {
        method: "POST",
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Error al subir imagen")
      }
    } finally {
      setUploadingImage(false)
    }
  }

  const onSubmit = async (data: InventarioFormData) => {
    setLoading(true)
    try {
      const url = item ? `/api/inventario/${item.id}` : "/api/inventario"
      const method = item ? "PUT" : "POST"

      // Fallback explícito de barcode: si RHF entregó null/undefined pero el
      // input visual tiene contenido (por setValue() programático del scanner
      // u otra interacción que no dispara setValueAs), leemos via watch() y
      // normalizamos antes de enviar.
      const barcodeFromWatch = (watch("barcode") || "").toString().trim()
      const normalizedBarcode = barcodeFromWatch.length > 0 ? barcodeFromWatch : null

      // El costo se manda solo si la fuente lo expuso. Cuando el item llega con
      // `precioCompra: null` el input arranca en 0 porque necesita un número —
      // pero ese 0 es "no lo recibí", no "vale cero". Como el payload se
      // spreadea entero y no hay filtro de campos sucios, mandarlo pisaría el
      // precio_compra real con cero. El PUT lo acepta opcional, así que
      // omitirlo deja la columna intacta.
      const { precioCompra, ...rest } = data
      const costoField = costoCargado ? { precioCompra } : {}

      const payload = item
        ? { ...rest, ...costoField, barcode: normalizedBarcode }
        : {
            ...rest,
            ...costoField,
            barcode: normalizedBarcode,
            codigo: generatedCode,
            descripcion: "",
          }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errorData = await res.json()
        // Si es error de código duplicado en item nuevo, regenerar código y reintentar
        if (!item && res.status === 400 && errorData.error?.includes("código")) {
          await fetchCode(data.categoria, data.tipoDispositivo)
          await showWarning("El código generado ya existía. Se generó uno nuevo, intentá guardar de nuevo.")
          return
        }
        await showError(errorData.error || "Error al guardar item")
        return
      }

      const savedItem = await res.json()
      const savedId = savedItem?.id || item?.id
      if (!savedId) {
        throw new Error("No se pudo obtener el id del item guardado")
      }

      // Manejo de imagen:
      //  - Si el usuario pidió quitar la existente, llamar DELETE
      //  - Si hay archivo pendiente, subirlo
      if (removeExistingImage && !pendingFile) {
        await fetch(`/api/inventario/${savedId}/imagen`, { method: "DELETE" }).catch(() => {})
      }
      if (pendingFile) {
        try {
          await uploadPendingImage(savedId)
        } catch (err) {
          console.error("Error subiendo imagen:", err)
          await showWarning("El item se guardó pero hubo un error al subir la imagen")
        }
      }

      // Solo en el camino exitoso. Los `return` de mas arriba (error de la API,
      // codigo duplicado a reintentar) dejan el borrador donde esta: es lo unico
      // irrecuperable de los dos lados.
      clearDraft()
      onSuccess()
    } catch (error) {
      console.error("Error saving item:", error)
      await showError("Error al guardar item")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle>{item ? "Editar Item" : "Nuevo Item"}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          onSubmit={handleSubmit(onSubmit)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            const t = e.target as HTMLElement
            const tag = t.tagName
            if (tag === "TEXTAREA") return
            if (tag === "BUTTON" && (t as HTMLButtonElement).type === "submit") return
            e.preventDefault()
          }}
          className="space-y-4"
        >
          {/* Primero el conflicto: el borrador se conserva, pero guardarlo
              reemplaza lo que guardó la otra persona. */}
          {recordChangedWhileEditing && <RecordChangedNotice />}
          {draftNoticeVisible && (
            <DraftRestoredNotice
              onDiscard={discardDraft}
              // La foto se queda afuera del borrador por diseño (es un `File`).
              // El aviso lo dice solo cuando había una: decirlo siempre es ruido
              // sobre los altas que ni la usan.
              detail={
                appliedDraft?.ui?.imagenPendiente
                  ? "La foto no se guarda en el borrador: volvé a seleccionarla."
                  : undefined
              }
            />
          )}

          {/* Fila con imagen + nombre */}
          <div className="flex gap-4 items-start">
            <div className="shrink-0">
              <Label className="mb-1 block">Imagen</Label>
              <div className="relative h-24 w-24 rounded-lg border-2 border-dashed border-border bg-muted/30 overflow-hidden flex items-center justify-center group">
                {imagenPreview ? (
                  <>
                    <img
                      src={imagenPreview}
                      alt="Preview"
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={handleImageRemove}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Quitar imagen"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <Package className="h-8 w-8 text-muted-foreground/50" />
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleImagePick(file)
                  }}
                  title="Seleccionar imagen"
                />
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-1 text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <ImagePlus className="h-3 w-3" />
                {imagenPreview ? "Cambiar" : "Subir foto"}
              </button>
            </div>
            <div className="flex-1">
              <Label htmlFor="nombre">Nombre *</Label>
              <Input
                id="nombre"
                {...register("nombre", { onBlur: () => checkDuplicates() })}
                placeholder="Ej: Batería iPhone 12"
                autoFocus
              />
              {errors.nombre && (
                <p className="text-sm text-destructive mt-1">
                  {errors.nombre.message}
                </p>
              )}
            </div>
          </div>

          {!item && duplicates.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <div className="flex-1">
                  <p className="font-medium">
                    {duplicates.length === 1
                      ? "Posible duplicado: hay un producto con nombre similar."
                      : `Posibles duplicados: ${duplicates.length} productos con nombre similar.`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Revisá si es el mismo. Podés sumar stock al existente, editarlo, o crear uno nuevo igualmente.
                  </p>
                </div>
              </div>
              <ul className="space-y-1.5">
                {duplicates.map((match) => (
                  <li
                    key={match.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 rounded border bg-background p-2 text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{match.nombre}</div>
                      <div className="text-xs text-muted-foreground">
                        {match.codigo} · {match.tipoDispositivo} / {match.categoria} · Stock: {match.stock}
                        {match.proveedor ? ` · ${match.proveedor}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        className="h-8 gap-1"
                        onClick={() => handleConsolidate(match)}
                        disabled={consolidating !== null}
                      >
                        {consolidating === match.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlusCircle className="h-3.5 w-3.5" />
                        )}
                        Sumar stock
                      </Button>
                      {onEditExisting && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1"
                          onClick={() => handleEditExisting(match)}
                          disabled={consolidating !== null}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar este
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tipoDispositivo">Tipo *</Label>
              {showNewTipo ? (
                <div className="flex gap-1.5">
                  <Input
                    value={newTipo}
                    onChange={(e) => setNewTipo(e.target.value)}
                    placeholder="Ej: Drone, Cafetera..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleAddTipo() }
                      if (e.key === "Escape") { setShowNewTipo(false); setNewTipo("") }
                    }}
                    disabled={savingTipo}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 h-9 w-9"
                    onClick={handleAddTipo}
                    disabled={!newTipo.trim() || savingTipo}
                  >
                    {savingTipo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 h-9 w-9"
                    onClick={() => { setShowNewTipo(false); setNewTipo("") }}
                    disabled={savingTipo}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <Select
                    value={tipoDispositivo || ""}
                    onValueChange={onSelectValueChange((value) =>
                      setValue("tipoDispositivo", value, { shouldValidate: true, shouldDirty: true })
                    )}
                    disabled={tiposLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={tiposLoading ? "Cargando tipos..." : "Seleccionar..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {tiposDispositivo.map((tipo) => (
                        <SelectItem key={tipo.id} value={tipo.codigo}>
                          {tipo.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0 h-9 w-9"
                    onClick={() => setShowNewTipo(true)}
                    title="Agregar tipo"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {errors.tipoDispositivo && (
                <p className="text-sm text-destructive mt-1">
                  {errors.tipoDispositivo.message}
                </p>
              )}
              {tiposError && (
                <p className="text-sm text-destructive mt-1 cursor-pointer" onClick={refetchTipos}>
                  Error al cargar tipos. Toca para reintentar.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="categoria">Categoría *</Label>
              {showNewCategoria ? (
                <div className="flex gap-1.5">
                  <Input
                    value={newCategoria}
                    onChange={(e) => setNewCategoria(e.target.value)}
                    placeholder="Nueva categoría..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleAddCategoria() }
                      if (e.key === "Escape") { setShowNewCategoria(false); setNewCategoria("") }
                    }}
                    disabled={savingCategoria}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 h-9 w-9"
                    onClick={handleAddCategoria}
                    disabled={!newCategoria.trim() || savingCategoria}
                  >
                    {savingCategoria ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 h-9 w-9"
                    onClick={() => { setShowNewCategoria(false); setNewCategoria("") }}
                    disabled={savingCategoria}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <Select
                    value={watch("categoria") || ""}
                    onValueChange={onSelectValueChange((value) =>
                      setValue("categoria", value, { shouldValidate: true, shouldDirty: true })
                    )}
                    disabled={!tipoDispositivo}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={tipoDispositivo ? "Seleccionar..." : "Elegí tipo primero"} />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasDisponibles.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0 h-9 w-9"
                    onClick={() => setShowNewCategoria(true)}
                    disabled={!tipoDispositivo}
                    title="Agregar categoría"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
              {errors.categoria && (
                <p className="text-sm text-destructive mt-1">
                  {errors.categoria.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="stock">Stock *</Label>
              <Input
                id="stock"
                type="text"
                inputMode="numeric"
                {...register("stock", { valueAsNumber: true })}
                min={0}
              />
              {errors.stock && (
                <p className="text-sm text-destructive mt-1">
                  {errors.stock.message}
                </p>
              )}
            </div>

            <div>
              {costoCargado ? (
                <>
                  <Label htmlFor="precioCompra">Costo *</Label>
                  <Input
                    id="precioCompra"
                    type="text"
                    inputMode="decimal"
                    step="0.01"
                    {...register("precioCompra", { setValueAs: (v: string) => parseMoneyInput(v) })}
                    min={0}
                    placeholder="0.00"
                  />
                  {errors.precioCompra && (
                    <p className="text-sm text-destructive mt-1">
                      {errors.precioCompra.message}
                    </p>
                  )}
                </>
              ) : (
                // El item llegó sin costo. El input necesita un número y
                // arrancaría en 0, así que mostrarlo le inventa un precio al
                // operador: un 0 se lee como gratis. Se oculta y se explica,
                // igual que inventario-list muestra "—" para este mismo null.
                <>
                  <Label className="text-muted-foreground">Costo</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Sin permiso para ver el costo. El valor guardado no se modifica.
                  </p>
                </>
              )}
            </div>

            <div>
              <Label htmlFor="precioVenta">Precio Venta *</Label>
              <Input
                id="precioVenta"
                type="text"
                inputMode="decimal"
                step="0.01"
                {...register("precioVenta", { setValueAs: (v: string) => parseMoneyInput(v) })}
                min={0}
                placeholder="0.00"
              />
              {errors.precioVenta && (
                <p className="text-sm text-destructive mt-1">
                  {errors.precioVenta.message}
                </p>
              )}
            </div>
          </div>

          {/* Proveedor */}
          <div>
            <Label htmlFor="proveedor">Proveedor</Label>
            <Select
              value={watch("proveedorId") || "none"}
              onValueChange={onSelectValueChange((value) =>
                setValue("proveedorId", value === "none" ? null : value, {
                  shouldDirty: true,
                })
              )}
            >
              <SelectTrigger id="proveedor">
                <SelectValue placeholder="Sin proveedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin proveedor</SelectItem>
                {proveedores
                  .filter((p) => p.activo !== false)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stock thresholds (collapsible) */}
          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowStockConfig(!showStockConfig)}
            >
              {showStockConfig ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Configuración de stock
            </button>
            {showStockConfig && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                <div>
                  <Label htmlFor="stockMinimo">Stock Mínimo</Label>
                  <Input
                    id="stockMinimo"
                    type="text"
                    inputMode="numeric"
                    {...register("stockMinimo", {
                      setValueAs: (v: string) => v === "" || v === null ? null : parseInt(v, 10),
                    })}
                    min={0}
                    placeholder="Auto"
                  />
                </div>
                <div>
                  <Label htmlFor="stockMaximo">Stock Máximo</Label>
                  <Input
                    id="stockMaximo"
                    type="text"
                    inputMode="numeric"
                    {...register("stockMaximo", {
                      setValueAs: (v: string) => v === "" || v === null ? null : parseInt(v, 10),
                    })}
                    min={0}
                    placeholder="Sin límite"
                  />
                </div>
                <div>
                  <Label htmlFor="puntoReorden">Punto Reorden</Label>
                  <Input
                    id="puntoReorden"
                    type="text"
                    inputMode="numeric"
                    {...register("puntoReorden", {
                      setValueAs: (v: string) => v === "" || v === null ? null : parseInt(v, 10),
                    })}
                    min={0}
                    placeholder="Auto"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ubicacion" className="flex items-center gap-1.5 text-sm font-medium">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              Ubicación en depósito
            </Label>
            <Input
              id="ubicacion"
              {...register("ubicacion", {
                setValueAs: (v: string) => v === "" || v === null ? null : v,
              })}
              placeholder="Ej: Rack 1 / Fila 2 / Columna 3"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              Dónde está físicamente el repuesto en tu depósito.
            </p>
            {errors.ubicacion && (
              <p className="text-sm text-destructive">{errors.ubicacion.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="barcode">Código de Barras</Label>
            <Input
              id="barcode"
              {...register("barcode", {
                setValueAs: (v: string) => {
                  if (v === null || v === undefined) return null
                  const t = String(v).trim()
                  return t === "" ? null : t
                },
              })}
              placeholder="Escanear o ingresar código de barras"
              inputMode="text"
              autoComplete="off"
            />
            {(() => {
              const v = (watch("barcode") || "").trim()
              if (!v) return null
              const err = validateBarcode(v)
              if (err) {
                const label = err.kind === "invalid_ean13" ? "EAN-13" : err.kind === "invalid_ean8" ? "EAN-8" : "UPC-A"
                return (
                  <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800">
                    Dígito verificador {label} no cierra. Sugerido:{" "}
                    <button
                      type="button"
                      className="font-mono underline hover:opacity-80"
                      onClick={() => setValue("barcode", err.expected, { shouldDirty: true, shouldValidate: true })}
                    >
                      {err.expected}
                    </button>
                    . Podés guardar tal cual si es un código interno.
                  </div>
                )
              }
              if (/^\d{12}$/.test(v)) {
                const check = computeEAN13CheckDigit(v)
                if (check) {
                  return (
                    <p className="text-xs text-muted-foreground mt-1">
                      12 dígitos detectados. Para EAN-13 agregá dígito verificador:{" "}
                      <button
                        type="button"
                        className="font-mono underline text-primary hover:text-primary/80"
                        onClick={() => setValue("barcode", v + check, { shouldDirty: true, shouldValidate: true })}
                      >
                        {v + check}
                      </button>
                    </p>
                  )
                }
              }
              return null
            })()}
          </div>

          {/* Warranty default */}
          <div>
            <Label htmlFor="diasGarantiaDefault">Días de garantía por defecto</Label>
            <Input
              id="diasGarantiaDefault"
              type="text"
              inputMode="numeric"
              {...register("diasGarantiaDefault", {
                setValueAs: (v: string) => {
                  if (v === "" || v === null || v === undefined) return null
                  const n = parseInt(v, 10)
                  return isNaN(n) ? null : n
                },
              })}
              min={0}
              placeholder="Usa el default de la organización"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Días de garantía pre-cargados al agregar este producto en el POS. Dejalo vacío para usar el valor de la organización.
            </p>
          </div>

          {/* Tracking avanzado — opt-in por item */}
          <details className="border rounded-md">
            <summary className="cursor-pointer text-sm font-medium px-3 py-2 hover:bg-muted/40">
              Tracking avanzado
            </summary>
            <div className="p-3 space-y-2 border-t">
              <p className="text-xs text-muted-foreground">
                Activá sólo las features que vas a usar. Cada una habilita su dialog en el menú del item.
              </p>
              <label className="flex items-center justify-between gap-3 p-2 rounded hover:bg-muted/30 cursor-pointer">
                <div>
                  <div className="text-sm">Trackear lotes / vencimientos</div>
                  <div className="text-[11px] text-muted-foreground">Cada entrada asocia un # de lote y fecha de vencimiento.</div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  {...register("trackeaLotes")}
                />
              </label>
              <label className="flex items-center justify-between gap-3 p-2 rounded hover:bg-muted/30 cursor-pointer">
                <div>
                  <div className="text-sm">Trackear números de serie</div>
                  <div className="text-[11px] text-muted-foreground">1 fila por unidad con S/N único. Útil para garantías.</div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  {...register("trackeaSeries")}
                />
              </label>
              <label className="flex items-center justify-between gap-3 p-2 rounded hover:bg-muted/30 cursor-pointer">
                <div>
                  <div className="text-sm">Tiene variantes</div>
                  <div className="text-[11px] text-muted-foreground">Color/talle/capacidad con stock + precio + barcode propios.</div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  {...register("tieneVariantes")}
                />
              </label>
              <label className="flex items-center justify-between gap-3 p-2 rounded hover:bg-muted/30 cursor-pointer">
                <div>
                  <div className="text-sm">Es kit / combo</div>
                  <div className="text-[11px] text-muted-foreground">Item compuesto por N componentes con cantidades.</div>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  {...register("esKit")}
                />
              </label>
              {watch("esKit") && (
                <div className="pl-3">
                  <Label className="text-xs">Tipo de kit</Label>
                  <Select
                    value={watch("tipoKit") ?? "ENSAMBLADO"}
                    onValueChange={onSelectValueChange((v) =>
                      setValue("tipoKit", v as "ENSAMBLADO" | "VIRTUAL", { shouldDirty: true })
                    )}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENSAMBLADO">Ensamblado (stock propio)</SelectItem>
                      <SelectItem value="VIRTUAL">Virtual (descuenta componentes)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </details>

          <FormActionBar className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || uploadingImage || (!item && !generatedCode)}>
              {uploadingImage ? "Subiendo imagen..." : loading ? "Guardando..." : "Guardar"}
            </Button>
          </FormActionBar>
        </form>
      </CardContent>
    </Card>
  )
}
