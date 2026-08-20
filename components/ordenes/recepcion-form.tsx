"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FormActionBar } from "@/components/ui/form-action-bar"
import { DraftRestoredNotice } from "@/components/ui/draft-restored-notice"
import { Plus } from "lucide-react"
import { ClienteSelector } from "@/components/cotizaciones/cliente-selector"
import { SignaturePad } from "@/components/firma/signature-pad"
import { compressImage } from "@/lib/image-compression"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import { useIsMobileViewport } from "@/hooks/use-is-mobile-viewport"
import { useFormDraft } from "@/hooks/use-form-draft"
import { useTerminologia } from "@/contexts/currency-context"
import { useOffline } from "@/contexts/offline-context"
import { useModal } from "@/contexts/modal-context"
import { STORES } from "@/lib/offline/constants"
import { FALLBACK_CONFIG } from "@/lib/tipos-dispositivo-defaults"
import type { Cliente, CampoExtra, AccesorioConfig, TipoDispositivoCustom } from "@/types"
import type { FotoPreview } from "./fotos-ingreso"
import { RecepcionEquipoCard, equipoFormSchema, type EquipoFormValues } from "./recepcion-equipo-card"
import { RecepcionCreadaModal, type EquipoRecepcionEnviado } from "./recepcion-creada-modal"

const recepcionFormSchema = z.object({
  clienteId: z.string().min(1, "Elegi el cliente"),
  telefonoContacto: z.string().optional(),
  observaciones: z.string().optional(),
  equipos: z.array(equipoFormSchema).min(2, "Carga al menos 2 equipos"),
})

type RecepcionFormData = z.infer<typeof recepcionFormSchema>

/** Estado por equipo que no vive en react-hook-form. */
export interface EquipoSideState {
  accesoriosSeleccionados: string[]
  otroAccesorio: string
  camposExtraValues: Record<string, any>
  fotos: FotoPreview[]
}

const equipoSideStateVacio = (): EquipoSideState => ({
  accesoriosSeleccionados: [],
  otroAccesorio: "",
  camposExtraValues: {},
  fotos: [],
})

/** Snapshot de EquipoSideState sin `fotos`: los File/preview base64 no son
 *  serializables de forma segura para localStorage (ver useFormDraft). Las
 *  fotos adjuntas nunca se restauran desde un borrador. */
type EquipoSideStateDraft = Omit<EquipoSideState, "fotos">

/** Forma persistida por useFormDraft para este formulario. La firma del
 *  cliente tampoco se incluye (mismo motivo que las fotos: dato binario).
 *  `selectedCliente` SI se incluye: ClienteSelector re-hidrata su propio
 *  display a partir del id, pero nunca llama a onChange, asi que sin esto el
 *  modal de exito muestra el nombre del cliente en blanco. */
interface RecepcionDraftValue {
  form: RecepcionFormData
  sideState: EquipoSideStateDraft[]
  terminosAceptados: boolean
  selectedCliente: Cliente | null
}

const equipoVacio = (): EquipoFormValues => ({
  dispositivo: "",
  tipoDispositivo: "",
  marca: "",
  color: "",
  imei: "",
  problemaReportado: "",
  codigoAccesoDispositivo: "",
})

/** Forma de un equipo en el payload que espera POST /api/recepciones (ver
 *  equipoSchema en app/api/recepciones/route.ts). */
export type EquipoPayload = EquipoFormValues & {
  accesorios?: string
  metadata?: Record<string, any>
  fotos?: Array<{ data: string; mime: string; descripcion?: string }>
}

/**
 * Resuelve los accesorios disponibles de un tipo de dispositivo sin usar el
 * hook useTipoDispositivoConfig: ese hook usa useMemo y no se puede llamar
 * fuera de un componente (ni en un loop de onSubmit, donde hace falta esto
 * mismo por equipo). Replica solo la resolucion config -> accesorios que el
 * hook usa internamente. Funcion pura: mismo input, mismo output, sin hooks.
 */
export function resolverAccesoriosDisponibles(
  codigoTipo: string,
  tiposDispositivo: TipoDispositivoCustom[]
): AccesorioConfig[] {
  const tipo = tiposDispositivo.find((t) => t.codigo === codigoTipo)
  const config = tipo?.config && Object.keys(tipo.config).length > 0 ? tipo.config : FALLBACK_CONFIG
  return config.accesorios || FALLBACK_CONFIG.accesorios || []
}

/**
 * Arma el objeto de un equipo tal como lo espera el endpoint POST
 * /api/recepciones. Funcion pura (sin hooks, sin contexto, sin componente):
 * es la logica mas riesgosa del formulario -- las tres correcciones del
 * dispatch original viven aca -- y la unica forma de testearla sin montar
 * React (sin ModalProvider, sin canvas) es que no dependa de ninguno de
 * los dos.
 *
 * - Los accesorios se serializan como LABELS ("Cargador, Cable USB"), no
 *   como ids ("cargador, cable"): el alta clasica los guarda asi
 *   (orden-form.tsx onSubmit) y el detalle de orden + el comprobante impreso
 *   los muestran tal cual se guardaron. Un id no encontrado en
 *   `accesoriosDisponibles` (por ejemplo, el texto libre agregado via "otro")
 *   cae de vuelta al id mismo, que en ese caso ES el texto que el usuario
 *   escribio.
 * - Las fotos separan el prefijo "data:image/...;base64," del contenido:
 *   base64ToBuffer (lib/storage.ts) hace un Buffer.from(base64, "base64")
 *   liso, sin sacar ese prefijo. Si no se separa aca, la imagen sube
 *   corrupta sin ningun error visible en ningun lado.
 * - No se envia `tipo` en cada foto: el endpoint fija `tipo: "INGRESO"` el
 *   mismo (ver app/api/recepciones/route.ts).
 */
export function construirEquipoPayload(
  equipo: EquipoFormValues,
  side: EquipoSideState,
  tiposDispositivo: TipoDispositivoCustom[]
): EquipoPayload {
  const disponibles = resolverAccesoriosDisponibles(equipo.tipoDispositivo, tiposDispositivo)
  const accesoriosLabels = side.accesoriosSeleccionados.map((id) => {
    const acc = disponibles.find((a) => a.id === id)
    return acc ? acc.label : id
  })

  const metadata: Record<string, any> = {}
  for (const [key, val] of Object.entries(side.camposExtraValues)) {
    if (val !== "" && val !== undefined && val !== null) {
      metadata[key] = val
    }
  }

  const fotos = side.fotos
    .filter((f) => f.file)
    .map((f) => {
      const base64Match = f.preview.match(/^data:(image\/[a-z]+);base64,(.+)$/)
      return {
        data: base64Match ? base64Match[2] : "",
        mime: base64Match ? base64Match[1] : "image/jpeg",
        descripcion: f.descripcion || undefined,
      }
    })

  return {
    ...equipo,
    accesorios: accesoriosLabels.length > 0 ? accesoriosLabels.join(", ") : undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    fotos: fotos.length > 0 ? fotos : undefined,
  }
}

/**
 * Resultado que devuelve POST /api/recepciones al crear el lote. Los campos
 * organization* vienen del mismo endpoint (igual que POST /api/ordenes ya
 * hace para el alta clasica), no de un fetch aparte -- ver
 * recepcion-creada-modal.tsx.
 */
interface RecepcionCreadaResultado {
  recepcion: { id: string; numero: number; codigo: string }
  ordenes: Array<{
    id: string
    numeroOrden: number
    codigoOrden: string
    dispositivo: string
    publicToken: string
  }>
  organizationName: string | null
  organizationTelefono: string | null
  organizationDireccion: string | null
  organizationComprobanteTerminos: string | null
}

export function RecepcionForm() {
  const term = useTerminologia()
  const router = useRouter()
  const { offlineFetch } = useOffline()
  const { showError, showInfo } = useModal()
  const { tipos: tiposDispositivo, loading: tiposLoading } = useTiposDispositivo()
  const isMobile = useIsMobileViewport()

  // Alto REAL de la barra sticky (mobile), medido con ResizeObserver -- no un
  // numero fijo. La barra puede ocupar 1 o 2 filas segun cuanto entren
  // "N equipos" + "Agregar otro equipo" + el submit en el ancho disponible
  // (flex-wrap en el FormActionBar de mas abajo), asi que un alto fijo
  // (h-24) se quedaba corto en pantallas angostas: el checkbox "El cliente
  // acepta los terminos", que onSubmit exige, quedaba tapado por la barra
  // incluso scrolleando hasta el final. 130 es solo el valor del primer
  // frame, antes de que el observer reporte la medida real -- la garantia
  // de correctitud es barHeight, no este default.
  const barWrapperRef = useRef<HTMLDivElement>(null)
  const [barHeight, setBarHeight] = useState(130)

  useEffect(() => {
    const el = barWrapperRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setBarHeight(Math.ceil(entry.contentRect.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null)
  const [firma, setFirma] = useState<string | null>(null)
  const [firmaMime, setFirmaMime] = useState<string | null>(null)
  const [terminosAceptados, setTerminosAceptados] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [comprimiendo, setComprimiendo] = useState(false)

  // Al tener valor, se abre RecepcionCreadaModal con este resultado. Ver el
  // seam mas abajo, despues del submit.
  const [resultado, setResultado] = useState<RecepcionCreadaResultado | null>(null)
  // Datos por equipo tal como se enviaron en el submit -- POST /api/recepciones
  // no los devuelve en su respuesta, asi que el modal de exito (etiquetas +
  // comprobante) los necesita aparte. Alineado por indice con
  // resultado.ordenes.
  const [equiposEnviados, setEquiposEnviados] = useState<EquipoRecepcionEnviado[]>([])

  const {
    control,
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    reset,
    formState: { errors },
  } = useForm<RecepcionFormData>({
    resolver: zodResolver(recepcionFormSchema),
    defaultValues: {
      clienteId: "",
      telefonoContacto: "",
      observaciones: "",
      // El minimo son 2 equipos: arranca con 2 para que el mostrador no
      // tenga que hacer un click extra para llegar al caso minimo.
      equipos: [equipoVacio(), equipoVacio()],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "equipos" })
  const [sideState, setSideState] = useState<EquipoSideState[]>([
    equipoSideStateVacio(),
    equipoSideStateVacio(),
  ])

  const clienteId = watch("clienteId")

  // --- Borrador local (useFormDraft) ----------------------------------------
  // Siempre "new record" (esta pantalla no tiene modo edicion), asi que no
  // hace falta recordId. La firma y las fotos de cada equipo quedan afuera
  // del snapshot: son datos binarios, no formularios recuperables.
  const [draftNoticeVisible, setDraftNoticeVisible] = useState(false)
  const draftAppliedRef = useRef(false)
  const { draft, ready: draftReady, clearDraft, notifyChange } = useFormDraft<RecepcionDraftValue>({
    feature: "recepcion-form",
    // `getValues()` en vez de `watch()`: leer el form entero en render
    // suscribe el componente a cada tecla de cada equipo. El borrador no
    // necesita re-render, solo el valor al momento de grabar.
    getValue: () => ({
      form: getValues(),
      sideState: sideState.map(({ fotos: _fotos, ...rest }) => rest),
      terminosAceptados,
      selectedCliente,
    }),
  })

  // Los cambios de react-hook-form ya no re-renderizan el formulario, asi que
  // hay que avisarle al borrador por suscripcion.
  useEffect(() => {
    const subscription = watch(() => notifyChange())
    return () => subscription.unsubscribe()
  }, [watch, notifyChange])

  useEffect(() => {
    if (!draftReady || draftAppliedRef.current) return
    draftAppliedRef.current = true
    if (!draft) return
    reset(draft.form)
    setSideState(
      draft.form.equipos.map((_, i) => ({
        ...equipoSideStateVacio(),
        ...draft.sideState[i],
      }))
    )
    setTerminosAceptados(draft.terminosAceptados)
    setSelectedCliente(draft.selectedCliente ?? null)
    setDraftNoticeVisible(true)
  }, [draftReady, draft, reset])

  const discardDraft = () => {
    clearDraft()
    setDraftNoticeVisible(false)
    reset({
      clienteId: "",
      telefonoContacto: "",
      observaciones: "",
      equipos: [equipoVacio(), equipoVacio()],
    })
    setSideState([equipoSideStateVacio(), equipoSideStateVacio()])
    setTerminosAceptados(false)
    setSelectedCliente(null)
  }

  // --- Mantener fields (react-hook-form) y sideState sincronizados ---------
  // Un desalineado aca manda, por ejemplo, las fotos del equipo 2 a la orden
  // del equipo 3: agregar/quitar SIEMPRE toca los dos arrays, en el mismo
  // indice.
  const agregarEquipo = () => {
    append(equipoVacio())
    setSideState((prev) => [...prev, equipoSideStateVacio()])
  }

  const quitarEquipo = (index: number) => {
    if (fields.length <= 2) return // el minimo es 2
    remove(index)
    setSideState((prev) => prev.filter((_, i) => i !== index))
  }

  const actualizarSide = (index: number, patch: Partial<EquipoSideState>) => {
    setSideState((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  // --- Handlers por equipo ---------------------------------------------------

  const handleTipoChange = (index: number, nuevoTipo: string) => {
    setValue(`equipos.${index}.tipoDispositivo`, nuevoTipo, { shouldValidate: true })
    // Igual que en el alta clasica: cambiar de tipo limpia accesorios y
    // campos extra, porque pertenecen a la config del tipo anterior.
    actualizarSide(index, { accesoriosSeleccionados: [], camposExtraValues: {} })
  }

  const handleCampoExtraChange = (index: number, campo: CampoExtra, value: any) => {
    actualizarSide(index, {
      camposExtraValues: { ...sideState[index].camposExtraValues, [campo.key]: value },
    })
    // Mismos efectos que handleCampoExtraChange del flujo clasico, pero sobre
    // los nombres de campo de este equipo.
    if (campo.usarComoDispositivo && typeof value === "string") {
      setValue(`equipos.${index}.dispositivo`, value, { shouldValidate: true })
    }
    if (campo.autoMarca && typeof value === "string") {
      for (const [keyword, brand] of Object.entries(campo.autoMarca)) {
        if (value.includes(keyword)) {
          setValue(`equipos.${index}.marca`, brand)
          break
        }
      }
    }
  }

  const toggleAccesorio = (index: number, id: string) => {
    const actual = sideState[index].accesoriosSeleccionados
    actualizarSide(index, {
      accesoriosSeleccionados: actual.includes(id)
        ? actual.filter((a) => a !== id)
        : [...actual, id],
    })
  }

  const setOtroAccesorio = (index: number, value: string) => {
    actualizarSide(index, { otroAccesorio: value })
  }

  const addOtroAccesorio = (index: number) => {
    const value = sideState[index].otroAccesorio.trim()
    if (!value) return
    actualizarSide(index, {
      accesoriosSeleccionados: [...sideState[index].accesoriosSeleccionados, value],
      otroAccesorio: "",
    })
  }

  // Manejar seleccion de fotos por equipo: replica el handler de
  // orden-form.tsx (compresion incluida) pero escribe en sideState[index]
  // en lugar de un unico estado de fotos.
  const handleFileChange = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const fileArray = Array.from(files)
    e.target.value = ""

    setComprimiendo(true)

    const processFile = async (file: File): Promise<FotoPreview | null> => {
      if (!file.type.startsWith("image/")) {
        return null
      }

      try {
        const compressedFile = await compressImage(file)

        return new Promise((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            resolve({
              id: Math.random().toString(36).substr(2, 9),
              preview: reader.result as string,
              file: compressedFile,
              descripcion: "",
            })
          }
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(compressedFile)
        })
      } catch (error) {
        console.error("Error procesando imagen:", error)
        return null
      }
    }

    try {
      const results = await Promise.all(fileArray.map(processFile))
      const validPhotos = results.filter((p): p is FotoPreview => p !== null)

      if (validPhotos.length > 0) {
        actualizarSide(index, { fotos: [...sideState[index].fotos, ...validPhotos] })
      }

      const fallidas = fileArray.length - validPhotos.length
      if (fallidas > 0) {
        await showError(
          fallidas === fileArray.length
            ? "No se pudo procesar ninguna imagen. Verifica que sean archivos de imagen validos."
            : `${fallidas} de ${fileArray.length} imagenes no se pudieron procesar.`
        )
      }
    } finally {
      setComprimiendo(false)
    }
  }

  const removeFoto = (index: number, id: string) => {
    actualizarSide(index, { fotos: sideState[index].fotos.filter((f) => f.id !== id) })
  }

  const updateFotoDescripcion = (index: number, id: string, descripcion: string) => {
    actualizarSide(index, {
      fotos: sideState[index].fotos.map((f) => (f.id === id ? { ...f, descripcion } : f)),
    })
  }

  const onSubmit = async (data: RecepcionFormData) => {
    if (!terminosAceptados) {
      await showError("El cliente tiene que aceptar los terminos de recepcion")
      return
    }
    setSubmitting(true)
    try {
      // El armado de cada equipo (labels de accesorios, split de foto
      // base64, etc.) vive en construirEquipoPayload -- funcion pura,
      // testeada aparte en __tests__/components/recepcion-payload.test.ts.
      const equiposPayload = data.equipos.map((equipo, i) =>
        construirEquipoPayload(equipo, sideState[i], tiposDispositivo)
      )
      const payload = {
        clienteId: data.clienteId,
        telefonoContacto: data.telefonoContacto || undefined,
        observaciones: data.observaciones || undefined,
        firmaCliente: firma || undefined,
        firmaMime: firmaMime || undefined,
        terminosAceptados,
        equipos: equiposPayload,
      }

      const res = await offlineFetch(
        "/api/recepciones",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        { store: STORES.ORDERS, description: `Recepcion de ${data.equipos.length} equipos` }
      )

      if (res.status === 202) {
        // Encolado offline: el body sintetico ({ _offline, tempId, message })
        // no tiene la forma de RecepcionCreadaResultado, asi que no hay nada
        // que mostrarle al modal de exito todavia (se sincroniza solo).
        clearDraft()
        await showInfo("Recepcion guardada offline. Se sincronizara automaticamente cuando vuelva la conexion.")
        return
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        await showError(err.error || "Error al crear la recepcion")
        return
      }

      clearDraft()
      const creada: RecepcionCreadaResultado = await res.json()
      // Snapshot de lo enviado: problemaReportado/tipoDispositivo/marca/
      // accesorios no vuelven en la respuesta del endpoint (a diferencia de
      // POST /api/ordenes), asi que el modal los necesita de aca, alineados
      // por indice con creada.ordenes.
      setEquiposEnviados(
        equiposPayload.map((equipo) => ({
          problemaReportado: equipo.problemaReportado,
          tipoDispositivo: equipo.tipoDispositivo,
          marca: equipo.marca || null,
          color: equipo.color || null,
          imei: equipo.imei || null,
          accesorios: equipo.accesorios ?? null,
        }))
      )
      // Al setear `resultado`, RecepcionCreadaModal se abre con
      // { recepcion, ordenes } y desde ahi salen impresion, etiquetas y
      // WhatsApp agrupado.
      setResultado(creada)
    } catch (error) {
      console.error("Error creando recepcion:", error)
      await showError("Error al crear la recepcion")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {draftNoticeVisible && (
            <DraftRestoredNotice onDiscard={discardDraft} />
          )}

          <div>
            <ClienteSelector
              value={clienteId || null}
              onChange={(id, cliente) => {
                setValue("clienteId", id || "", { shouldValidate: !!id })
                setSelectedCliente(cliente as Cliente | null)
              }}
            />
            {errors.clienteId && (
              <p className="text-sm text-destructive mt-1">{errors.clienteId.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="telefonoContacto">Telefono de contacto</Label>
            <Input
              id="telefonoContacto"
              {...register("telefonoContacto")}
              placeholder={selectedCliente?.telefono || "Numero alternativo"}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
          </div>

          <div className="space-y-4">
            {fields.map((field, index) => (
              <RecepcionEquipoCard
                key={field.id}
                index={index}
                tipos={tiposDispositivo}
                tiposLoading={tiposLoading}
                tipoSeleccionado={watch(`equipos.${index}.tipoDispositivo`)}
                onTipoChange={(codigo) => handleTipoChange(index, codigo)}
                register={register}
                errors={errors.equipos?.[index]}
                puedeQuitar={fields.length > 2}
                onQuitar={() => quitarEquipo(index)}
                accesoriosSeleccionados={sideState[index]?.accesoriosSeleccionados || []}
                onToggleAccesorio={(id) => toggleAccesorio(index, id)}
                otroAccesorio={sideState[index]?.otroAccesorio || ""}
                onOtroAccesorioChange={(value) => setOtroAccesorio(index, value)}
                onOtroAccesorioAdd={() => addOtroAccesorio(index)}
                camposExtraValues={sideState[index]?.camposExtraValues || {}}
                onCampoExtraChange={(campo, value) => handleCampoExtraChange(index, campo, value)}
                onProblemaQuickSelect={(texto) =>
                  setValue(`equipos.${index}.problemaReportado`, texto, { shouldValidate: true })
                }
                fotos={sideState[index]?.fotos || []}
                comprimiendo={comprimiendo}
                onFileChange={(e) => handleFileChange(index, e)}
                onRemoveFoto={(id) => removeFoto(index, id)}
                onFotoDescripcionChange={(id, value) => updateFotoDescripcion(index, id, value)}
                labelFotos={`Fotos del ${term("equipo")} (Ingreso)`}
                codigoAcceso={watch(`equipos.${index}.codigoAccesoDispositivo`) || ""}
                onCodigoAccesoChange={(value) =>
                  setValue(`equipos.${index}.codigoAccesoDispositivo`, value)
                }
              />
            ))}
          </div>

          {/* En mobile este boton vive en la barra sticky de abajo (junto al
              contador y "Crear recepcion"): con dos tarjetas largas arriba
              quedaba fuera de pantalla y un mostrador real penso que el
              limite era 2 equipos. isMobile decide cual de los dos se monta
              -- nunca los dos a la vez, mismo agregarEquipo en ambos. */}
          {!isMobile && (
            <Button type="button" variant="outline" onClick={agregarEquipo} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              Agregar otro equipo
            </Button>
          )}

          <div>
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              {...register("observaciones")}
              placeholder="Observaciones generales de la recepcion..."
              rows={2}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conformidad del cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Una sola firma cubre los {fields.length} equipos de esta recepcion.
              </p>
              <SignaturePad
                label="Firma del cliente (conformidad de recepcion)"
                onSignatureChange={(data, mime) => {
                  setFirma(data)
                  setFirmaMime(mime)
                }}
                disabled={submitting}
              />
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={terminosAceptados}
                  onChange={(e) => setTerminosAceptados(e.target.checked)}
                  className="mt-0.5"
                />
                <span>El cliente acepta los terminos de recepcion</span>
              </label>
            </CardContent>
          </Card>

          {/* Despeje para que la barra sticky de abajo (mobile) no tape el
              final de la tarjeta de conformidad mientras se scrollea --
              position: sticky solo reserva su propio alto al final del
              flujo, asi que sin este espacio el checkbox de conformidad
              queda debajo de la barra hasta llegar al final del todo. Alto
              MEDIDO (barHeight), no fijo -- ver comentario junto al
              ResizeObserver mas arriba. */}
          <div className="sm:hidden" style={{ height: barHeight }} aria-hidden="true" />

          <div ref={barWrapperRef}>
            <FormActionBar className="flex-wrap justify-end">
              {isMobile && (
                <span
                  className="mr-auto text-sm font-medium text-muted-foreground"
                  aria-live="polite"
                  data-testid="equipo-counter"
                >
                  {fields.length} equipos
                </span>
              )}
              {isMobile && (
                <Button type="button" variant="outline" size="sm" onClick={agregarEquipo}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar otro equipo
                </Button>
              )}
              <Button type="submit" disabled={submitting}>
                {/* Label mas corto en mobile: el contador ya muestra la
                    cantidad de equipos, no hace falta repetirla y asi el
                    boton entra en la fila junto a "Agregar otro equipo" en
                    mas pantallas (menos filas = menos alto de barra). En
                    desktop el label completo queda igual que siempre. */}
                {submitting
                  ? "Creando..."
                  : isMobile
                    ? "Crear recepcion"
                    : `Crear recepcion (${fields.length} equipos)`}
              </Button>
            </FormActionBar>
          </div>
        </form>

        {resultado && (
          <RecepcionCreadaModal
            open
            resultado={resultado}
            equipos={equiposEnviados}
            cliente={{
              nombre: selectedCliente?.nombre || "",
              telefono: watch("telefonoContacto") || selectedCliente?.telefono || "",
            }}
            firma={firma}
            firmaMime={firmaMime}
            onClose={() => {
              setResultado(null)
              router.push("/ordenes")
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}
