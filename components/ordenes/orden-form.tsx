"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useSession } from "next-auth/react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import { FormActionBar } from "@/components/ui/form-action-bar"
import { DraftRestoredNotice } from "@/components/ui/draft-restored-notice"
import { X, Plus, Loader2, Lock, Grid3X3, ClipboardCheck, ChevronDown, ChevronUp } from "lucide-react"
import { PatternLock } from "@/components/ui/pattern-lock"
import { ClienteSelector } from "@/components/cotizaciones/cliente-selector"
import { OrdenCreadaModal } from "./orden-creada-modal"
import { UpgradeModal } from "@/components/billing/upgrade-modal"
import { usePlanLimitError } from "@/lib/hooks/use-plan-limit-error"
import { compressImage } from "@/lib/image-compression"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import { useTipoDispositivoConfig } from "@/hooks/use-tipo-dispositivo-config"
import { useFormDraft } from "@/hooks/use-form-draft"
import { useTerminologia } from "@/contexts/currency-context"
import { SignaturePad } from "@/components/firma/signature-pad"
import { useOffline } from "@/contexts/offline-context"
import { useModal } from "@/contexts/modal-context"
import { STORES } from "@/lib/offline/constants"
import type { Cliente, CampoExtra } from "@/types"
import { isValidImei, sanitizeImei } from "@/lib/imei"
import { parseMoneyInput } from "@/lib/parse-money"
import { FotosIngreso, type FotoPreview } from "./fotos-ingreso"
import { AccesoriosPicker } from "./accesorios-picker"
import { TipoDispositivoPicker } from "./tipo-dispositivo-picker"
import { CamposExtraFields } from "./campos-extra-fields"

const ordenSchema = z.object({
  clienteId: z.string().min(1, "El cliente es requerido"),
  dispositivo: z.string().min(1, "El dispositivo es requerido"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  marca: z.string().optional(),
  color: z.string().optional(),
  imei: z.string().optional().or(z.literal("")),
  problemaReportado: z.string().min(1, "El problema es requerido"),
  accesorios: z.string().optional(),
  codigoAccesoDispositivo: z.string().optional(),
  telefonoContacto: z.string().optional(),
  presupuesto: z.union([z.number().positive(), z.nan(), z.undefined()]).optional(),
  fechaPrometida: z.string().optional(),
  observaciones: z.string().optional(),
  notasInternas: z.string().optional(),
})

type OrdenFormData = z.infer<typeof ordenSchema>

/** Valores base del formulario. Vive afuera del componente (sin dependencias
 *  de hooks) para que useForm(defaultValues) y el discard del borrador usen
 *  la MISMA lista: cuando se duplicaba a mano, los campos que faltaban en la
 *  copia (register() sin control) se quedaban con el texto del borrador
 *  descartado y se enviaban igual en el submit. */
function ordenFormDefaults(): OrdenFormData {
  return {
    clienteId: "",
    dispositivo: "",
    tipoDispositivo: "",
    marca: "",
    color: "",
    imei: "",
    problemaReportado: "",
    accesorios: "",
    codigoAccesoDispositivo: "",
    telefonoContacto: "",
    presupuesto: undefined,
    fechaPrometida: "",
    observaciones: "",
    notasInternas: "",
  }
}

/** Lo que este formulario consume del cliente elegido: el id (para saber si el
 *  objeto corresponde al clienteId cargado), nombre y telefono (modal de orden
 *  creada, placeholder de contacto), y tipoCliente/razonSocial/cuit para el
 *  bloque de empresa. Se guarda esto en el estado en vez del Cliente entero
 *  para que ningun campo de la ficha llegue al formulario sin que se note. */
type ClienteResumen = Pick<
  Cliente,
  "id" | "nombre" | "telefono" | "tipoCliente" | "razonSocial" | "cuit"
>

/** Proyeccion que ademas se persiste. El cuit queda afuera: es dato fiscal del
 *  cliente y solo alimenta una linea informativa del bloque de empresa, que
 *  puede vivir sin el hasta que se vuelva a elegir el cliente. */
type ClienteDraftSnapshot = Omit<ClienteResumen, "cuit">

/** Estructura minima que alcanza para proyectar. Mas laxa que el Cliente del
 *  dominio a proposito: el buscador (cliente-selector.tsx) declara su propio
 *  tipo con casi todo opcional, y los prefills (turno, deep-link) llegan como
 *  JSON sin tipar. */
interface ClienteProyectable {
  id: string
  nombre: string
  telefono?: string | null
  tipoCliente?: string | null
  razonSocial?: string | null
  cuit?: string | null
}

function toClienteResumen(cliente: ClienteProyectable | null | undefined): ClienteResumen | null {
  if (!cliente) return null
  return {
    id: cliente.id,
    nombre: cliente.nombre,
    telefono: cliente.telefono ?? "",
    tipoCliente: (cliente.tipoCliente ?? undefined) as ClienteResumen["tipoCliente"],
    razonSocial: cliente.razonSocial ?? null,
    cuit: cliente.cuit ?? null,
  }
}

/** Snapshot persistido por useFormDraft (hooks/use-form-draft.ts). Deja
 *  afuera fotos, firma del checklist (binarios), el codigo de acceso del
 *  equipo (ver el limite de persistencia en getValue) y todo lo que se
 *  re-obtiene solo con fetch (listas de tecnicos/operadores/sectores, template
 *  del checklist). Una proyeccion del cliente SI se guarda: ClienteSelector
 *  re-hidrata su propio display a partir del id, pero nunca llama a onChange
 *  (ver cliente-selector.tsx), asi que sin esto el selector de Sector/Area de
 *  empresas no aparece y el modal de orden creada sale sin nombre ni
 *  telefono del cliente.
 *
 *  `sena` y `presupuestoAceptado` tampoco entran, por el mismo motivo que
 *  `terminosAceptados` en recepcion-form.tsx: un borrador no puede reclamar
 *  plata. La sena genera un movimiento de caja en el submit y "presupuesto
 *  aceptado" es la conformidad que lo habilita, asi que restaurarlos registra
 *  un cobro que el cliente nunca hizo en esta visita. Perderlos al restaurar
 *  es aceptable; inventar un pago no. */
interface OrdenDraftValue {
  form: Omit<OrdenFormData, "codigoAccesoDispositivo">
  selectedClienteObj: ClienteDraftSnapshot | null
  accesoriosSeleccionados: string[]
  otroAccesorio: string
  camposExtraValues: Record<string, any>
  metodoPagoSena: string
  selectedSectorId: string
  selectedTecnicoId: string
  selectedRecibidoPorId: string
  checklistValores: Record<string, boolean | string | null>
  /** Template al que pertenecen las CLAVES de `checklistValores`. El template
   *  en si no se persiste (se re-pide por tipo de equipo al restaurar), y sin
   *  este id no habia forma de notar que el de la organizacion cambio en los 7
   *  dias que vive el borrador: las respuestas quedaban indexadas por items que
   *  ya no existen. Opcional para los borradores escritos antes de que este
   *  campo existiera, que se tratan como "de otro template". */
  checklistTemplateId?: string | null
  checklistNotas: string
}

interface OrdenFormProps {
  onClose: () => void
  onSuccess: () => void
  fromTurnoId?: string
  initialClienteId?: string
  /** Cuando se renderiza dentro de un overlay/sheet con scroll propio: la barra
   *  de acciones se ancla al fondo del sheet en vez de despejar el bottom-nav. */
  inSheet?: boolean
}

interface OrdenCreadaData {
  id: string
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  problemaReportado: string
  presupuesto?: number | null
  fechaPrometida?: string | null
  publicToken?: string | null
  cliente: {
    nombre: string
    telefono: string
  }
  telefonoContacto?: string | null
  organizationName?: string
  // Campos extra para comprobante térmico
  tipoDispositivo?: string
  marca?: string | null
  color?: string | null
  imei?: string | null
  accesorios?: string | null
  observaciones?: string | null
  estado?: string
  costoFinal?: number | null
  fechaIngreso?: string | null
  clienteId?: string
  organizationLogoUrl?: string | null
  organizationTelefono?: string | null
  organizationDireccion?: string | null
  organizationComprobanteTerminos?: string | null
}

export function OrdenForm({ onClose, onSuccess, fromTurnoId, initialClienteId, inSheet = false }: OrdenFormProps) {
  const term = useTerminologia()
  const { offlineFetch } = useOffline()
  const { showError, showInfo } = useModal()
  const { data: session } = useSession()
  const isTecnicoRole = session?.user?.role === "TECNICO"
  const [loading, setLoading] = useState(false)
  const [selectedClienteObj, setSelectedClienteObj] = useState<ClienteResumen | null>(null)
  const [fotos, setFotos] = useState<FotoPreview[]>([])
  const [accesoriosSeleccionados, setAccesoriosSeleccionados] = useState<string[]>([])
  const [otroAccesorio, setOtroAccesorio] = useState("")
  const [passwordType, setPasswordType] = useState<"text" | "pattern">("text")
  const [showOrdenCreadaModal, setShowOrdenCreadaModal] = useState(false)
  const [ordenCreada, setOrdenCreada] = useState<OrdenCreadaData | null>(null)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const planLimitError = usePlanLimitError()
  const [presupuestoAceptado, setPresupuestoAceptado] = useState(false)
  // Draft en string para permitir escribir decimales (coma es-AR). Se parsea con senaNum.
  const [sena, setSena] = useState("")
  const senaNum = parseMoneyInput(sena)
  const [metodoPagoSena, setMetodoPagoSena] = useState<string>("EFECTIVO")
  const [comprimiendo, setComprimiendo] = useState(false)
  const [camposExtraValues, setCamposExtraValues] = useState<Record<string, any>>({})
  const [selectedSectorId, setSelectedSectorId] = useState<string>("")
  const [sectoresCliente, setSectoresCliente] = useState<Array<{ id: string; nombre: string }>>([])
  const [tecnicosDisponibles, setTecnicosDisponibles] = useState<Array<{ id: string; nombre: string; activo: boolean }>>([])
  const [selectedTecnicoId, setSelectedTecnicoId] = useState<string>("")
  const [operadoresDisponibles, setOperadoresDisponibles] = useState<Array<{ id: string; nombre: string }>>([])
  const [selectedRecibidoPorId, setSelectedRecibidoPorId] = useState<string>("")
  const [nuevoSectorNombre, setNuevoSectorNombre] = useState("")
  const [crearSectorLoading, setCrearSectorLoading] = useState(false)
  const [checklistTemplate, setChecklistTemplate] = useState<any>(null)
  const [checklistValores, setChecklistValores] = useState<Record<string, boolean | string | null>>({})
  const [checklistNotas, setChecklistNotas] = useState("")
  const [checklistFirma, setChecklistFirma] = useState<string | null>(null)
  const [checklistFirmaMime, setChecklistFirmaMime] = useState<string | null>(null)
  /** Se incrementa para remontar el SignaturePad (mismo mecanismo que
   *  recepcion-form.tsx). El pad es NO controlado: el trazo vive en su canvas y
   *  solo lo borra su propio boton "Limpiar", asi que poner `checklistFirma` en
   *  null no lo toca. Cada vez que el formulario descarta la firma tiene que
   *  bumpear esta key, o la pantalla sigue mostrando el trazo y el cartel
   *  "Firma capturada" de una conformidad que la orden ya no lleva. */
  const [firmaResetKey, setFirmaResetKey] = useState(0)
  const [checklistOpen, setChecklistOpen] = useState(true)
  /** Origen de las respuestas del checklist que restauro un borrador, mientras
   *  todavia no llego el template contra el que hay que compararlas. Ver el
   *  descarte de respuestas huerfanas en el efecto que trae el template. */
  const checklistDelBorradorRef = useRef<{
    templateId: string | null
    tipoDispositivo: string
  } | null>(null)
  const [currentStep, setCurrentStep] = useState(1)
  const totalSteps = 3
  // Prefill desde turno
  const [turnoPrefill, setTurnoPrefill] = useState<null | {
    requiereCrearCliente: boolean
    clienteSnapshot: { nombre: string; telefono: string; email?: string | null } | null
  }>(null)
  const { tipos: tiposDispositivo, loading: tiposLoading } = useTiposDispositivo()

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    getValues,
    trigger,
    clearErrors,
    setError,
    reset,
  } = useForm<OrdenFormData>({
    resolver: zodResolver(ordenSchema),
    defaultValues: ordenFormDefaults(),
  })

  const tipoDispositivo = watch("tipoDispositivo")

  // --- Borrador local (useFormDraft) ----------------------------------------
  // Siempre "new record": esta pantalla solo crea ordenes, nunca las edita.
  // El `scope` separa los borradores por origen: una orden abandonada desde un
  // turno (o desde un deep-link ?clienteId=) no tiene por que reaparecer en el
  // alta de mostrador siguiente, que es otra orden distinta.
  const [draftNoticeVisible, setDraftNoticeVisible] = useState(false)
  /** El borrador ya aplicado, POR IDENTIDAD y no un booleano ni un scope:
   *  `fromTurnoId` / `initialClienteId` salen de useSearchParams
   *  (ordenes-list.tsx) y el overlay se queda montado, asi que abrir el alta de
   *  otro turno desde la agenda cambia la key del hook sin remontar este
   *  componente. Un latch booleano se quedaba pegado en el primer borrador y el
   *  segundo no se aplicaba nunca (el hook si lo contaba como restaurado, asi
   *  que el flush siguiente lo pisaba con lo que quedo en pantalla del turno
   *  anterior); un latch por scope se adelanta al hook, porque el scope cambia
   *  en el render y `draft` recien en el commit siguiente, y aplica el borrador
   *  del turno viejo sobre el nuevo. La identidad del objeto es lo unico que
   *  esta sincronizado con el estado del hook: cada re-lectura devuelve uno
   *  nuevo, cada re-render devuelve el mismo. */
  const draftAppliedRef = useRef<OrdenDraftValue | null>(null)
  const draftRestoredRef = useRef(false)
  /** Raiz del formulario para el gate de interaccion del hook: ClienteSelector
   *  monta ClienteForm (su propio <form>) adentro de este, y escribir en ese
   *  dialog no es una edicion del alta. */
  const formRef = useRef<HTMLFormElement>(null)
  const { draft, ready: draftReady, clearDraft, notifyChange } = useFormDraft<OrdenDraftValue>({
    feature: "orden-form",
    // El restore recorre estructuras del borrador (checklistValores,
    // accesoriosSeleccionados): un borrador viejo con otra forma haria estallar
    // el efecto que las aplica y el alta quedaria en pantalla blanca.
    validate: (data) => {
      const value = data as OrdenDraftValue
      return (
        !!value &&
        typeof value.form === "object" &&
        value.form !== null &&
        Array.isArray(value.accesoriosSeleccionados) &&
        typeof value.checklistValores === "object" &&
        value.checklistValores !== null
      )
    },
    rootRef: formRef,
    scope: fromTurnoId
      ? `turno:${fromTurnoId}`
      : initialClienteId
        ? `cliente:${initialClienteId}`
        : null,
    // `getValues()` en vez de `watch()`: leer el form entero en render
    // suscribe este componente (1500 lineas, 3 pasos) a cada tecla. El
    // borrador no necesita re-render, solo el valor al momento de grabar.
    //
    // LIMITE DE PERSISTENCIA — lo que se devuelve aca queda en localStorage en
    // texto plano, 7 dias, en una terminal que comparten varios operadores y
    // que no borra nada al cerrar sesion. Solo entra lo que el formulario
    // restaurado necesita para seguir cargandose: nada de codigos de acceso al
    // equipo, nada de la ficha del cliente mas alla de la proyeccion de abajo.
    // Antes de agregar un campo aca, preguntarse si molestaria verlo en la
    // pantalla del proximo turno.
    getValue: () => {
      const { codigoAccesoDispositivo: _codigo, ...form } = getValues()
      return {
        form,
        selectedClienteObj: selectedClienteObj
          ? {
              id: selectedClienteObj.id,
              nombre: selectedClienteObj.nombre,
              telefono: selectedClienteObj.telefono,
              tipoCliente: selectedClienteObj.tipoCliente,
              razonSocial: selectedClienteObj.razonSocial,
            }
          : null,
        accesoriosSeleccionados,
        otroAccesorio,
        camposExtraValues,
        metodoPagoSena,
        selectedSectorId,
        selectedTecnicoId,
        selectedRecibidoPorId,
        checklistValores,
        // Las claves de `checklistValores` son ids de items de ESTE template:
        // sin el id, un borrador restaurado despues de que la organizacion lo
        // editara manda respuestas huerfanas bajo el templateId nuevo.
        checklistTemplateId: checklistTemplate?.id ?? null,
        checklistNotas,
      }
    },
  })

  // Los cambios de react-hook-form ya no re-renderizan el formulario, asi que
  // hay que avisarle al borrador por suscripcion.
  useEffect(() => {
    const subscription = watch(() => notifyChange())
    return () => subscription.unsubscribe()
  }, [watch, notifyChange])

  useEffect(() => {
    if (!draftReady) return
    // El latch se toca DESPUES de saber que hay algo que aplicar (mismo
    // criterio que cliente-form.tsx). Marcarlo antes dejaba el formulario "con
    // el borrador ya aplicado" sin haberlo aplicado: si el hook volvia a
    // resolver la key (otro turno, una sesion que se cae y vuelve) y aparecia un
    // borrador que otra pestana habia escrito, este efecto no lo tocaba nunca
    // -- pero el hook si lo contaba como restaurado, asi que el flush siguiente
    // lo pisaba en silencio con lo que hubiera en pantalla y el aviso no salia.
    if (!draft) {
      // Key nueva y sin borrador: lo que quedo marcado como restaurado era del
      // origen anterior, y con esa marca puesta el prefill de ESTE turno se
      // saltea a si mismo al resolver (lee draftRestoredRef).
      draftRestoredRef.current = false
      return
    }
    if (draftAppliedRef.current === draft) return
    draftAppliedRef.current = draft
    draftRestoredRef.current = true
    try {
      // El codigo de acceso no se persiste (ver el limite en getValue): se
      // repone vacio para no dejar el campo en undefined si un borrador viejo
      // todavia lo trae.
      reset({ ...draft.form, codigoAccesoDispositivo: "" })
      setSelectedClienteObj(draft.selectedClienteObj ?? null)
      setAccesoriosSeleccionados(draft.accesoriosSeleccionados)
      setOtroAccesorio(draft.otroAccesorio)
      setCamposExtraValues(draft.camposExtraValues)
      // La plata NO se restaura (ni se guarda, ver OrdenDraftValue). Un
      // borrador viejo puede traer todavia los dos campos: se reponen en cero
      // explicitamente para que ni siquiera por ahi se cuele un cobro.
      setPresupuestoAceptado(false)
      setSena("")
      setMetodoPagoSena(draft.metodoPagoSena)
      setSelectedSectorId(draft.selectedSectorId)
      setSelectedTecnicoId(draft.selectedTecnicoId)
      setSelectedRecibidoPorId(draft.selectedRecibidoPorId)
      setChecklistValores(draft.checklistValores)
      setChecklistNotas(draft.checklistNotas)
      // No se puede comparar todavia: el template se re-pide por tipo de equipo
      // y la lista de tipos aun no resolvio. Queda pendiente para el efecto que
      // lo trae (ver el descarte de respuestas huerfanas ahi).
      checklistDelBorradorRef.current =
        Object.keys(draft.checklistValores).length > 0
          ? {
              templateId: draft.checklistTemplateId ?? null,
              tipoDispositivo: draft.form.tipoDispositivo ?? "",
            }
          : null
      // El paso tampoco se restaura (ni se guarda): reabrir en el paso 3 deja
      // fuera de pantalla todo lo que se venia cargando, y arrancar en el 1
      // obliga a pasar por delante de cada campo antes de crear la orden.
      setDraftNoticeVisible(true)
    } catch (error) {
      // Ultima red, ademas del `validate` del hook: una excepcion aca corre
      // dentro de un efecto, o sea que desmonta el arbol entero y deja el alta
      // en blanco. Mejor perder el borrador que la pantalla.
      console.error("Borrador de orden invalido, se descarta:", error)
      draftRestoredRef.current = false
      clearDraft()
      setDraftNoticeVisible(false)
      reset(ordenFormDefaults())
    }
  }, [draftReady, draft, reset, clearDraft])

  /** Datos de origen ya traidos del servidor (turno / deep-link). Se guardan
   *  aunque el borrador gane, porque descartarlo tiene que devolver el
   *  formulario al estado precargado: los dos efectos que lo aplican dependen
   *  de [origen, draftReady] y descartar no mueve ninguna de las dos, asi que
   *  no vuelven a correr solos. */
  const turnoPrefillDataRef = useRef<any>(null)
  const deepLinkClienteRef = useRef<ClienteResumen | null>(null)

  /** Escribe en el formulario lo que vino del turno. Vive afuera del efecto
   *  para que el descarte pueda re-aplicarlo sin volver a pedirlo al servidor. */
  const applyTurnoPrefill = (d: any) => {
    if (d.cliente) {
      setSelectedClienteObj(toClienteResumen(d.cliente))
      setValue("clienteId", d.cliente.id, { shouldValidate: true })
    }
    if (d.orden?.tipoDispositivo) setValue("tipoDispositivo", d.orden.tipoDispositivo)
    if (d.orden?.dispositivo) setValue("dispositivo", d.orden.dispositivo)
    if (d.orden?.marca) setValue("marca", d.orden.marca)
    if (d.orden?.problemaReportado) setValue("problemaReportado", d.orden.problemaReportado)
    if (d.orden?.observaciones) setValue("observaciones", d.orden.observaciones)
    if (d.orden?.telefonoContacto) setValue("telefonoContacto", d.orden.telefonoContacto)
    if (d.orden?.tecnicoId) setSelectedTecnicoId(d.orden.tecnicoId)
    if (d.orden?.fechaPrometida) {
      setValue("fechaPrometida", String(d.orden.fechaPrometida).slice(0, 10))
    }
  }

  /** "Recibido por" que corresponde cuando el alta se abre limpia: el propio
   *  operador salvo que sea admin (ver el efecto que lo preselecciona). Se
   *  calcula afuera de ese efecto porque el descarte del borrador tiene que
   *  poder reponerlo: el efecto depende de la sesion, y descartar no la mueve,
   *  asi que no vuelve a correr solo. */
  const recibidoPorPorDefecto =
    session?.user?.id && session.user.role !== "ADMIN" ? session.user.id : ""

  const discardDraft = () => {
    clearDraft()
    setDraftNoticeVisible(false)
    draftRestoredRef.current = false
    reset(ordenFormDefaults())
    setAccesoriosSeleccionados([])
    setOtroAccesorio("")
    setCamposExtraValues({})
    setPresupuestoAceptado(false)
    setSena("")
    setMetodoPagoSena("EFECTIVO")
    setSelectedSectorId("")
    setSelectedTecnicoId("")
    setSelectedRecibidoPorId(recibidoPorPorDefecto)
    setChecklistValores({})
    setChecklistNotas("")
    // Ya no hay respuestas restauradas que comparar contra ningun template.
    checklistDelBorradorRef.current = null
    setCurrentStep(1)
    setSelectedClienteObj(null)
    // Fotos y firma del checklist no se persisten, asi que no vienen del
    // borrador -- pero si sobreviven al descarte se suben con la orden
    // siguiente: fotos de otro equipo y una conformidad firmada por otra
    // persona.
    setFotos([])
    setChecklistFirma(null)
    setChecklistFirmaMime(null)
    setFirmaResetKey((prev) => prev + 1)
    // Lo precargado por el origen NO es del borrador: descartar tiene que dejar
    // el alta como si se acabara de abrir desde el turno / deep-link. Sin esto
    // quedaba entera en blanco y la unica forma de recuperar los datos del
    // turno era recargar la pagina. Si el fetch todavia no respondio, el que se
    // encarga es el efecto: relee draftRestoredRef al resolver.
    if (fromTurnoId) {
      if (turnoPrefillDataRef.current) applyTurnoPrefill(turnoPrefillDataRef.current)
    } else if (initialClienteId) {
      setValue("clienteId", initialClienteId, { shouldValidate: true })
      if (deepLinkClienteRef.current) setSelectedClienteObj(deepLinkClienteRef.current)
    }
  }

  // Prefill desde turno (si la orden nace de una visita agendada).
  //
  // Espera a que el borrador se haya resuelto (draftReady) en vez de correr
  // en paralelo: los dos escriben los mismos campos y quien ganaba dependia
  // de cuando respondia el fetch. Precedencia definida: si hay borrador de
  // ESTE turno, lo que el usuario ya escribio gana y el prefill queda solo
  // para el aviso de "crear cliente".
  useEffect(() => {
    if (!fromTurnoId || !draftReady) return
    let cancelled = false
    fetch(`/api/turnos/${fromTurnoId}/prefill-orden`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error || "No se pudo cargar el turno")
        }
        return r.json()
      })
      .then((d) => {
        if (cancelled) return
        setTurnoPrefill({
          requiereCrearCliente: !!d.requiereCrearCliente,
          clienteSnapshot: d.clienteSnapshot || null,
        })
        // Se cachea siempre, incluso en modo "solo aviso": es lo que el
        // descarte del borrador re-aplica (ver discardDraft).
        turnoPrefillDataRef.current = d
        // Se relee al resolver, no al arrancar el efecto: si el operador
        // descarto el borrador mientras el fetch estaba en vuelo, el prefill
        // que llega es justo lo que hay que aplicar.
        if (draftRestoredRef.current) return
        applyTurnoPrefill(d)
      })
      .catch((err) => {
        void showError(err.message || "Error al cargar datos del turno")
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromTurnoId, draftReady])

  // Preselección de cliente vía deep-link (?clienteId=) — no aplica si viene
  // de turno. Misma precedencia que el prefill de turno: el borrador de este
  // mismo deep-link (la key lo incluye) gana sobre el re-prefill.
  useEffect(() => {
    if (!initialClienteId || fromTurnoId || !draftReady) return
    let cancelled = false
    if (!draftRestoredRef.current) {
      setValue("clienteId", initialClienteId, { shouldValidate: true })
    }
    // El cliente se pide igual aunque gane el borrador: descartarlo tiene que
    // poder devolverlo sin un segundo viaje al servidor (ver discardDraft).
    fetch(`/api/clientes/${initialClienteId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cliente) => {
        if (cancelled || !cliente || cliente.error) return
        const resumen = toClienteResumen(cliente)
        deepLinkClienteRef.current = resumen
        if (draftRestoredRef.current) return
        setSelectedClienteObj(resumen)
      })
      .catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClienteId, draftReady])

  // Get the selected tipo object (used below for the checklist template fetch by id)
  const tipoSeleccionado = useMemo(
    () => tiposDispositivo.find((t) => t.codigo === tipoDispositivo),
    [tiposDispositivo, tipoDispositivo]
  )

  // Get the selected tipo's effective config and its derived fields
  const {
    config,
    accesoriosDisponibles,
    problemasComunes,
    marcasDisponibles,
    camposExtra,
    showImei,
    showPassword,
    showColor,
    showMarca,
  } = useTipoDispositivoConfig(tiposDispositivo, tipoDispositivo)
  const imeiLabel = config.campos?.imei?.label || "Numero de Serie"
  const imeiPlaceholder = config.campos?.imei?.placeholder || "S/N del equipo"
  const imeiMaxLength = config.campos?.imei?.maxLength
  const imeiEsImei = config.campos?.imei?.validacion === "imei"

  // Handle campo extra changes with autoMarca and usarComoDispositivo support
  const handleCampoExtraChange = (campo: CampoExtra, value: any) => {
    setCamposExtraValues((prev) => ({ ...prev, [campo.key]: value }))

    // If this field replaces the device name
    if (campo.usarComoDispositivo && typeof value === "string") {
      setValue("dispositivo", value, { shouldValidate: true })
      if (value.trim()) clearErrors("dispositivo")
    }

    // Auto-fill brand based on keywords in value
    if (campo.autoMarca && typeof value === "string") {
      for (const [keyword, brand] of Object.entries(campo.autoMarca)) {
        if (value.includes(keyword)) {
          setValue("marca", brand)
          break
        }
      }
    }
  }

  // Clear fields when device type changes
  const handleTipoChange = (nuevoTipo: string) => {
    setValue("tipoDispositivo", nuevoTipo, { shouldValidate: true })
    if (nuevoTipo) clearErrors("tipoDispositivo")
    setAccesoriosSeleccionados([])
    setCamposExtraValues({})
    // Las respuestas del checklist pertenecen al template del tipo anterior.
    // Se limpian ACA (accion explicita del usuario) y no en el efecto que
    // trae el template: ese efecto tambien corre al montar y cuando la lista
    // de tipos resuelve tarde, y ahi borraba un checklist recien restaurado
    // de un borrador — con el agravante de que el submit solo guarda el
    // checklist si tiene valores, asi que se perdia sin ningun aviso.
    setChecklistValores({})
    setChecklistNotas("")
    setChecklistFirma(null)
    setChecklistFirmaMime(null)
    setFirmaResetKey((prev) => prev + 1)
    // If new type has a usarComoDispositivo field, clear dispositivo so it gets set by the field
    const nuevoTipoObj = tiposDispositivo.find((t) => t.codigo === nuevoTipo)
    const nuevoConfig = nuevoTipoObj?.config
    const hasUsarComoDispositivo = nuevoConfig?.camposExtra?.some((c) => c.usarComoDispositivo)
    if (hasUsarComoDispositivo) {
      setValue("dispositivo", "")
    }
  }

  // Fetch checklist template when device type changes
  useEffect(() => {
    const fetchChecklistTemplate = async () => {
      const tipoId = tipoSeleccionado?.id
      try {
        const url = tipoId
          ? `/api/checklist-templates/by-device-type?tipoDispositivoId=${tipoId}`
          : `/api/checklist-templates/by-device-type`
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          // Solo el template: las respuestas se limpian en handleTipoChange
          // (ver el comentario ahi). Este efecto tambien corre al montar.
          setChecklistTemplate(data.template)
          descartarRespuestasHuerfanas(data.template)
        }
      } catch (error) {
        console.error("Error fetching checklist template:", error)
      }
    }

    /** Las respuestas del checklist se indexan por id de item del template,
     *  pero el template no se persiste en el borrador: al restaurar se vuelve a
     *  pedir por tipo de equipo. Si la organizacion lo edito o lo reemplazo
     *  dentro de los 7 dias que vive el borrador, las claves restauradas no
     *  corresponden a ningun item: el checklist se dibuja vacio y el submit
     *  igual las manda bajo el templateId nuevo.
     *
     *  Se compara recien contra el template DEL TIPO DE EQUIPO DEL BORRADOR: el
     *  primer fetch del montaje sale con el tipo todavia sin resolver (la lista
     *  de tipos carga async y el reset del borrador recien escribio el campo) y
     *  trae el template por defecto de la organizacion, que no es ese. */
    const descartarRespuestasHuerfanas = (template: any) => {
      const delBorrador = checklistDelBorradorRef.current
      if (!delBorrador) return
      if ((tipoSeleccionado?.codigo ?? "") !== delBorrador.tipoDispositivo) return
      checklistDelBorradorRef.current = null
      if ((template?.id ?? null) !== delBorrador.templateId) {
        // Las notas son texto libre, no estan indexadas por item: se conservan.
        setChecklistValores({})
      }
    }

    fetchChecklistTemplate()
  }, [tipoSeleccionado?.id, tipoSeleccionado?.codigo])

  // Fetch sectors when client changes
  const clienteId = watch("clienteId")
  const clienteSeleccionadoObj = selectedClienteObj?.id === clienteId ? selectedClienteObj : undefined

  const esClienteEmpresa = clienteSeleccionadoObj?.tipoCliente === "EMPRESA" || !!clienteSeleccionadoObj?.razonSocial


  // Fetch técnicos disponibles (solo para ADMIN / no-TECNICO)
  useEffect(() => {
    if (isTecnicoRole) return
    const fetchTecnicos = async () => {
      try {
        const res = await fetch("/api/tecnicos", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        setTecnicosDisponibles(
          (data || [])
            .filter((t: any) => t.activo !== false)
            .map((t: any) => ({ id: t.id, nombre: t.nombre, activo: t.activo !== false }))
        )
      } catch (error) {
        console.error("Error fetching tecnicos:", error)
      }
    }
    fetchTecnicos()
  }, [isTecnicoRole])

  // Fetch operadores disponibles para "Recibido por".
  // Excluimos a los ADMIN: si no se elige a nadie, se asume que la orden la
  // recibió el administrador que la carga (resuelto server-side por fallback).
  useEffect(() => {
    fetch("/api/operadores")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setOperadoresDisponibles(
            data
              .filter((o) => o.rol !== "ADMIN")
              .map((o) => ({ id: o.id, nombre: o.nombre }))
          )
        }
      })
      .catch(() => {})
  }, [])

  // Pre-seleccionar al usuario actual solo si NO es admin. Para un admin se deja
  // "Sin asignar" a propósito: el fallback server-side ya lo registra como receptor.
  useEffect(() => {
    if (recibidoPorPorDefecto && !selectedRecibidoPorId) {
      setSelectedRecibidoPorId(recibidoPorPorDefecto)
    }
  }, [recibidoPorPorDefecto])

  // Sector elegido y lista de sectores del cliente. El sector se limpia solo
  // cuando el cliente CAMBIA de verdad: este efecto tambien corre al montar y
  // cuando `esClienteEmpresa` pasa a true (el objeto Cliente llega despues),
  // y ahi borraba el sector que acababa de restaurar un borrador.
  const sectoresClienteIdRef = useRef<string | null>(null)
  useEffect(() => {
    const clienteActual = clienteId || null
    const clienteAnterior = sectoresClienteIdRef.current
    sectoresClienteIdRef.current = clienteActual
    if (clienteAnterior !== null && clienteAnterior !== clienteActual) {
      setSelectedSectorId("")
    }
    setSectoresCliente([])
    if (!clienteId || !esClienteEmpresa) return

    const fetchSectores = async () => {
      try {
        const res = await fetch(`/api/clientes/${clienteId}/sectores`)
        if (res.ok) {
          const data = await res.json()
          setSectoresCliente(data)
        }
      } catch (error) {
        console.error("Error fetching sectores:", error)
      }
    }
    fetchSectores()
  }, [clienteId, esClienteEmpresa])

  // Manejar seleccion de fotos
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const fileArray = Array.from(files)

    // Limpia el input que disparo el evento (no via ref: los refs de los
    // <input type="file"> ahora viven dentro de FotosIngreso) para permitir
    // volver a seleccionar el mismo archivo. Equivalente al reset original
    // por refs: siempre se limpiaba el input que disparo el cambio.
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
        setFotos((prev) => [...prev, ...validPhotos])
      }

      // Un solo aviso agregado (evita apilar modales si fallan varias).
      const fallidas = fileArray.length - validPhotos.length
      if (fallidas > 0) {
        await showError(
          fallidas === fileArray.length
            ? "No se pudo procesar ninguna imagen. Verificá que sean archivos de imagen válidos."
            : `${fallidas} de ${fileArray.length} imágenes no se pudieron procesar.`
        )
      }
    } finally {
      setComprimiendo(false)
    }
  }

  const removeFoto = (id: string) => {
    setFotos((prev) => prev.filter((f) => f.id !== id))
  }

  const updateFotoDescripcion = (id: string, descripcion: string) => {
    setFotos((prev) =>
      prev.map((f) => (f.id === id ? { ...f, descripcion } : f))
    )
  }

  const toggleAccesorio = (id: string) => {
    setAccesoriosSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  const addOtroAccesorio = () => {
    if (otroAccesorio.trim()) {
      setAccesoriosSeleccionados((prev) => [...prev, otroAccesorio.trim()])
      setOtroAccesorio("")
    }
  }

  const handleCrearSector = async () => {
    if (!nuevoSectorNombre.trim() || !clienteId) return
    setCrearSectorLoading(true)
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sectores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nuevoSectorNombre.trim() }),
      })
      if (res.ok) {
        const sector = await res.json()
        setSectoresCliente((prev) => [...prev, sector])
        setSelectedSectorId(sector.id)
        setNuevoSectorNombre("")
      } else {
        const err = await res.json()
        await showError(err.error || "Error al crear sector")
      }
    } catch (e) {
      console.error("Error creating sector:", e)
    } finally {
      setCrearSectorLoading(false)
    }
  }

  const onSubmit = async (data: OrdenFormData) => {
    // Validate IMEI only when the field is configured as IMEI (15 digits)
    if (imeiEsImei && !isValidImei(data.imei)) {
      setError("imei", { message: "El IMEI debe tener exactamente 15 dígitos" })
      return
    }
    setLoading(true)
    try {
      // Build accessories labels
      const accesoriosLabels = accesoriosSeleccionados.map((id) => {
        const acc = accesoriosDisponibles.find((a) => a.id === id)
        return acc ? acc.label : id
      })

      // Prepare photos
      const fotosData = fotos.map((foto) => {
        const base64Match = foto.preview.match(/^data:(image\/[a-z]+);base64,(.+)$/)
        return {
          data: base64Match ? base64Match[2] : "",
          mime: base64Match ? base64Match[1] : "image/jpeg",
          descripcion: foto.descripcion || undefined,
          tipo: "INGRESO",
        }
      })

      // Build metadata from camposExtra values (non-empty only)
      const metadata: Record<string, any> = {}
      for (const [key, val] of Object.entries(camposExtraValues)) {
        if (val !== "" && val !== undefined && val !== null) {
          metadata[key] = val
        }
      }

      const ordenPayload = {
        ...data,
        accesorios: accesoriosLabels.length > 0 ? accesoriosLabels.join(", ") : undefined,
        presupuesto: data.presupuesto && data.presupuesto > 0 ? data.presupuesto : undefined,
        fechaPrometida: data.fechaPrometida || undefined,
        fotos: fotosData.length > 0 ? fotosData : undefined,
        presupuestoAceptado: presupuestoAceptado,
        sena: presupuestoAceptado && senaNum > 0 ? senaNum : undefined,
        metodoPagoSena: presupuestoAceptado && senaNum > 0 ? metodoPagoSena : undefined,
        observaciones: data.observaciones || undefined,
        notasInternas: data.notasInternas || undefined,
        telefonoContacto: data.telefonoContacto || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        sectorId: selectedSectorId || undefined,
        tecnicoId: !isTecnicoRole && selectedTecnicoId ? selectedTecnicoId : undefined,
        recibidoPorId: selectedRecibidoPorId || undefined,
        fromTurnoId: fromTurnoId || undefined,
      }

      const res = await offlineFetch("/api/ordenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ordenPayload),
      }, { store: STORES.ORDERS, description: `Orden - ${data.dispositivo}` })

      if (res.status === 202) {
        // Queued offline
        clearDraft()
        await showInfo("Orden guardada offline. Se sincronizará automáticamente cuando vuelva la conexión.")
        onSuccess?.()
        onClose()
        return
      }

      if (!res.ok) {
        // Detectar errores de límite de plan y abrir el upgrade modal en vez
        // de un alert genérico. Si no es plan-limit, fallback al alert.
        const handled = await planLimitError.handle(res)
        if (handled.shouldUpgrade) {
          setShowUpgradeModal(true)
          return
        }
        const error = await res.json().catch(() => ({}))
        await showError(error.error || "Error al crear orden")
        return
      }

      const nuevaOrden = await res.json()
      clearDraft()

      // Guardar checklist si hay template y valores completados
      if (checklistTemplate && Object.keys(checklistValores).length > 0) {
        try {
          const checklistBody = {
            templateId: checklistTemplate.id,
            valores: checklistValores,
            notas: checklistNotas || undefined,
            firmaCliente: checklistFirma || undefined,
            firmaMime: checklistFirmaMime || undefined,
          }
          const checklistRes = await offlineFetch(`/api/ordenes/${nuevaOrden.id}/checklist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(checklistBody),
          }, { store: STORES.ORDERS, description: `Checklist - ${data.dispositivo}` })
          if (!checklistRes.ok) {
            const checklistErr = await checklistRes.json().catch(() => ({}))
            console.error("[CHECKLIST SAVE] Error:", checklistRes.status, JSON.stringify(checklistErr))
          }
        } catch (checklistError) {
          console.error("[CHECKLIST SAVE] Exception:", checklistError)
        }
      }

      setOrdenCreada({
        id: nuevaOrden.id,
        numeroOrden: nuevaOrden.numeroOrden,
        codigoOrden: nuevaOrden.codigoOrden || undefined,
        dispositivo: data.dispositivo,
        problemaReportado: data.problemaReportado,
        presupuesto: data.presupuesto && data.presupuesto > 0 ? data.presupuesto : null,
        fechaPrometida: data.fechaPrometida || null,
        publicToken: nuevaOrden.publicToken || null,
        cliente: {
          nombre: selectedClienteObj?.nombre || "",
          telefono: selectedClienteObj?.telefono || "",
        },
        telefonoContacto: data.telefonoContacto || null,
        organizationName: nuevaOrden.organizationName || undefined,
        // Campos extra para comprobante térmico
        clienteId: data.clienteId,
        tipoDispositivo: data.tipoDispositivo,
        marca: data.marca || null,
        color: data.color || null,
        imei: data.imei || null,
        accesorios: accesoriosLabels.length > 0 ? accesoriosLabels.join(", ") : null,
        observaciones: data.observaciones || null,
        estado: nuevaOrden.estado || "RECIBIDO",
        costoFinal: nuevaOrden.costoFinal ?? null,
        fechaIngreso: nuevaOrden.fechaIngreso || null,
        organizationLogoUrl: nuevaOrden.organizationLogoUrl ?? null,
        organizationTelefono: nuevaOrden.organizationTelefono ?? null,
        organizationDireccion: nuevaOrden.organizationDireccion ?? null,
        organizationComprobanteTerminos: nuevaOrden.organizationComprobanteTerminos ?? null,
      })
      setShowOrdenCreadaModal(true)
    } catch (error) {
      console.error("Error creating orden:", error)
      await showError("Error al crear orden")
    } finally {
      setLoading(false)
    }
  }

  // Check if the selected type has a campo extra with usarComoDispositivo
  const campoDispositivo = camposExtra.find((c) => c.usarComoDispositivo)

  const validateStep = async (step: number): Promise<boolean> => {
    if (step === 1) {
      const result = await trigger(["clienteId", "dispositivo", "tipoDispositivo", "problemaReportado"])
      return result
    }
    return true
  }

  const handleNextStep = async () => {
    const isValid = await validateStep(currentStep)
    if (isValid) setCurrentStep((prev) => Math.min(prev + 1, totalSteps))
  }

  const handlePrevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1))
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Nueva {term("orden")}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {fromTurnoId && (
          <div className="mb-4 p-3 rounded-lg border border-primary/30 bg-primary/5">
            <p className="text-sm font-medium">Origen: turno agendado</p>
            <p className="text-xs text-muted-foreground">
              Los datos se cargaron desde el turno. Revisalos antes de crear la orden.
            </p>
            {turnoPrefill?.requiereCrearCliente && turnoPrefill.clienteSnapshot && (
              <div className="mt-2 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                <p className="text-xs text-amber-900 dark:text-amber-200 font-medium">
                  Este turno usa un cliente sin registrar.
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                  Datos: <strong>{turnoPrefill.clienteSnapshot.nombre}</strong> · {turnoPrefill.clienteSnapshot.telefono}
                  {turnoPrefill.clienteSnapshot.email ? ` · ${turnoPrefill.clienteSnapshot.email}` : ""}
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                  Creá primero el cliente con estos datos usando el botón <strong>+</strong> al lado del buscador de cliente.
                </p>
              </div>
            )}
          </div>
        )}
        <form ref={formRef} onSubmit={(e) => {
          e.preventDefault()
          if (currentStep < totalSteps) {
            handleNextStep()
          }
        }} className="space-y-4">
          {draftNoticeVisible && (
            <DraftRestoredNotice onDiscard={discardDraft} />
          )}

          {/* Step indicator */}
          {(() => {
            const stepsForLabel = [
              { step: 1, label: `Cliente y ${term("equipo")}` },
              { step: 2, label: "Detalles" },
              { step: 3, label: "Fotos y Checklist" },
            ]
            const current = stepsForLabel.find((s) => s.step === currentStep)
            return (
              <p className="text-xs text-center text-muted-foreground sm:hidden mb-2">
                Paso {currentStep}/{totalSteps}{current ? ` · ${current.label}` : ""}
              </p>
            )
          })()}
          <div className="flex items-center gap-2 mb-6">
            {[
              { step: 1, label: `Cliente y ${term("equipo")}` },
              { step: 2, label: "Detalles" },
              { step: 3, label: "Fotos y Checklist" },
            ].map(({ step, label }, index) => (
              <div key={step} className="flex items-center gap-2 flex-1">
                <button
                  type="button"
                  onClick={() => step < currentStep && setCurrentStep(step)}
                  className={`flex items-center gap-2 w-full p-2 rounded-lg text-sm font-medium transition-colors ${
                    step === currentStep
                      ? "bg-primary text-primary-foreground"
                      : step < currentStep
                      ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${
                    step === currentStep
                      ? "bg-primary-foreground text-primary"
                      : step < currentStep
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted-foreground/20 text-muted-foreground"
                  }`}>
                    {step < currentStep ? "✓" : step}
                  </span>
                  <span className="hidden sm:inline truncate">{label}</span>
                </button>
                {index < 2 && <div className={`h-px w-4 shrink-0 ${step < currentStep ? "bg-primary" : "bg-border"}`} />}
              </div>
            ))}
          </div>

          {currentStep === 1 && (<>
          <div>
            <ClienteSelector
              value={watch("clienteId") || null}
              onChange={(id, cliente) => {
                setValue("clienteId", id || "", { shouldValidate: !!id })
                // Proyectado en el acto: la ficha entera del cliente nunca
                // entra al estado que el borrador persiste (ver getValue).
                setSelectedClienteObj(toClienteResumen(cliente))
                if (id) clearErrors("clienteId")
              }}
            />
            {errors.clienteId && (
              <p className="text-sm text-destructive mt-1">
                {errors.clienteId.message}
              </p>
            )}
          </div>

          {/* Sector selector for empresa clients */}
          {esClienteEmpresa && (
            <div>
              <Label>Sector / Area</Label>
              {sectoresCliente.length > 0 ? (
                <Select
                  value={selectedSectorId}
                  onValueChange={setSelectedSectorId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar sector..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sectoresCliente.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground py-1">No hay sectores creados</p>
              )}
              <div className="flex gap-2 mt-2">
                <Input
                  value={nuevoSectorNombre}
                  onChange={(e) => setNuevoSectorNombre(e.target.value)}
                  placeholder="Nuevo sector (ej: Contaduria, Transito)"
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleCrearSector()
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!nuevoSectorNombre.trim() || crearSectorLoading}
                  onClick={handleCrearSector}
                >
                  {crearSectorLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
              {clienteSeleccionadoObj.razonSocial && (
                <p className="text-xs text-muted-foreground mt-1">
                  Empresa: {clienteSeleccionadoObj.razonSocial}
                  {clienteSeleccionadoObj.cuit && ` - CUIT: ${clienteSeleccionadoObj.cuit}`}
                </p>
              )}
            </div>
          )}

          {/* Tipo de dispositivo con selector visual */}
          <TipoDispositivoPicker
            tipos={tiposDispositivo}
            value={tipoDispositivo}
            onChange={handleTipoChange}
            loading={tiposLoading}
            error={errors.tipoDispositivo?.message}
          />

          {/* Marca y Dispositivo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Marca with quick select */}
            {showMarca && (
              <div>
                <Label htmlFor="marca">Marca</Label>
                <div className="space-y-2">
                  <Input
                    id="marca"
                    {...register("marca")}
                    placeholder="Ej: Apple, Samsung"
                  />
                  {marcasDisponibles.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {marcasDisponibles.slice(0, 5).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setValue("marca", m)}
                          className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                            watch("marca") === m
                              ? "bg-primary text-primary-foreground border-primary"
                              : "hover:bg-muted"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="dispositivo">
                {campoDispositivo ? campoDispositivo.label + " *" : "Modelo / Dispositivo *"}
              </Label>
              {campoDispositivo ? (
                <Select
                  value={watch("dispositivo") || ""}
                  onValueChange={(value) => handleCampoExtraChange(campoDispositivo, value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(campoDispositivo.opciones || []).map((op) => (
                      <SelectItem key={op} value={op}>{op}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="dispositivo"
                  {...register("dispositivo", {
                    onChange: (e) => {
                      if (e.target.value.trim()) clearErrors("dispositivo")
                    },
                  })}
                  placeholder="Modelo o descripcion del equipo"
                />
              )}
              {errors.dispositivo && (
                <p className="text-sm text-destructive mt-1">
                  {errors.dispositivo.message}
                </p>
              )}
            </div>
          </div>

          {/* Dynamic extra fields from config */}
          <CamposExtraFields
            campos={camposExtra}
            values={camposExtraValues}
            config={config}
            onChange={handleCampoExtraChange}
          />

          {/* Color and IMEI/Serial - driven by config visibility */}
          {(showColor || showImei) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {showColor && (
                <div>
                  <Label htmlFor="color">Color</Label>
                  <Input
                    id="color"
                    {...register("color")}
                    placeholder="Ej: Negro, Azul"
                  />
                </div>
              )}
              {showImei && (
                <div>
                  <Label htmlFor="imei">{imeiLabel}</Label>
                  <Input
                    id="imei"
                    {...register("imei", {
                      onChange: imeiEsImei
                        ? (e) => {
                            e.target.value = sanitizeImei(e.target.value)
                          }
                        : undefined,
                    })}
                    placeholder={imeiPlaceholder}
                    maxLength={imeiEsImei ? 15 : imeiMaxLength}
                    inputMode={imeiEsImei ? "numeric" : undefined}
                  />
                  {errors.imei && (
                    <p className="text-sm text-destructive mt-1">
                      {errors.imei.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Problema reportado con seleccion rapida */}
          <div>
            <Label htmlFor="problemaReportado">Problema Reportado *</Label>
            {problemasComunes.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-muted-foreground mb-1">Problemas comunes (clic para agregar):</p>
                <div className="flex flex-wrap gap-1">
                  {problemasComunes.map((problema) => (
                    <button
                      key={problema}
                      type="button"
                      onClick={() => {
                        const currentValue = watch("problemaReportado") || ""
                        const newValue = currentValue
                          ? `${currentValue}${currentValue.endsWith(".") || currentValue.endsWith("\n") ? " " : ". "}${problema}`
                          : problema
                        setValue("problemaReportado", newValue, { shouldValidate: true })
                        if (newValue.trim()) clearErrors("problemaReportado")
                      }}
                      className="px-2 py-1 text-xs rounded-full border bg-background hover:bg-primary hover:text-primary-foreground transition-colors"
                    >
                      {problema}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Textarea
              id="problemaReportado"
              {...register("problemaReportado", {
                onChange: (e) => {
                  if (e.target.value.trim()) clearErrors("problemaReportado")
                },
              })}
              placeholder="Describa el problema del equipo..."
              rows={3}
            />
            {errors.problemaReportado && (
              <p className="text-sm text-destructive mt-1">
                {errors.problemaReportado.message}
              </p>
            )}
          </div>
          </>)}

          {currentStep === 2 && (<>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="presupuesto">Presupuesto (Opcional)</Label>
              <Input
                id="presupuesto"
                type="text"
                inputMode="decimal"
                step="0.01"
                min="0"
                {...register("presupuesto", {
                  setValueAs: (value) => value === "" || value === null || value === undefined ? undefined : parseMoneyInput(value)
                })}
                placeholder="0.00"
              />
            </div>
            <DatePicker
              id="fechaPrometida"
              label="Fecha Prometida (Opcional)"
              value={watch("fechaPrometida")}
              onChange={(value) => setValue("fechaPrometida", value || "")}
              min={new Date().toISOString().split("T")[0]}
            />
          </div>

          {!isTecnicoRole && tecnicosDisponibles.length > 0 && (
            <div>
              <Label htmlFor="tecnicoId">{term("tecnico")} asignado (Opcional)</Label>
              <Select
                value={selectedTecnicoId || "NONE"}
                onValueChange={(v) => setSelectedTecnicoId(v === "NONE" ? "" : v)}
              >
                <SelectTrigger id="tecnicoId">
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Sin asignar</SelectItem>
                  {tecnicosDisponibles.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {operadoresDisponibles.length > 0 && (
            <div>
              <Label htmlFor="recibidoPorId">Recibido por</Label>
              <Select
                value={selectedRecibidoPorId || "NONE"}
                onValueChange={(v) => setSelectedRecibidoPorId(v === "NONE" ? "" : v)}
              >
                <SelectTrigger id="recibidoPorId">
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Sin asignar</SelectItem>
                  {operadoresDisponibles.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Si no seleccionás a nadie, queda registrado el administrador que carga la orden.
              </p>
            </div>
          )}

          {/* Presupuesto aceptado al momento */}
          {watch("presupuesto") && watch("presupuesto")! > 0 && (
            <div className="border rounded-lg p-4 bg-green-50/50">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={presupuestoAceptado}
                  onChange={(e) => {
                    setPresupuestoAceptado(e.target.checked)
                    if (!e.target.checked) setSena("")
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <div>
                  <span className="font-medium text-green-700">
                    Presupuesto aceptado al momento
                  </span>
                  <p className="text-xs text-muted-foreground">
                    El cliente acepta el precio y deja el equipo para reparacion
                  </p>
                </div>
              </label>

              {presupuestoAceptado && (
                <div className="mt-4 pl-7">
                  <Label htmlFor="sena">Seña / Adelanto (Opcional)</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-muted-foreground">$</span>
                    <Input
                      id="sena"
                      type="text"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max={watch("presupuesto") || undefined}
                      value={sena}
                      onChange={(e) => setSena(e.target.value)}
                      placeholder="0.00"
                      className="w-28 sm:w-40"
                    />
                  </div>
                  {senaNum > 0 && (
                    <div className="mt-2">
                      <Label className="text-xs text-muted-foreground">Método de pago de la seña</Label>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {[
                          { value: "EFECTIVO", label: "Efectivo" },
                          { value: "TRANSFERENCIA", label: "Transfer." },
                          { value: "MERCADOPAGO", label: "MP" },
                          { value: "OTRO", label: "Otro" },
                        ].map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setMetodoPagoSena(value)}
                            className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${
                              metodoPagoSena === value
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Accesorios recibidos - dynamic from config */}
          <AccesoriosPicker
            disponibles={accesoriosDisponibles}
            seleccionados={accesoriosSeleccionados}
            onToggle={toggleAccesorio}
            otro={otroAccesorio}
            onOtroChange={setOtroAccesorio}
            onOtroAdd={addOtroAccesorio}
          />

          {/* Password - driven by config visibility */}
          {showPassword && <div>
            <Label>Contrasena/Patron del Dispositivo</Label>
            <div className="flex gap-1 mt-2 mb-3">
              <Button
                type="button"
                variant={passwordType === "text" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setPasswordType("text")
                  setValue("codigoAccesoDispositivo", "")
                }}
                className="flex-1"
              >
                <Lock className="h-4 w-4 mr-2" />
                PIN / Contrasena
              </Button>
              <Button
                type="button"
                variant={passwordType === "pattern" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setPasswordType("pattern")
                  setValue("codigoAccesoDispositivo", "")
                }}
                className="flex-1"
              >
                <Grid3X3 className="h-4 w-4 mr-2" />
                Patron
              </Button>
            </div>
            {passwordType === "text" ? (
              <Input
                id="codigoAccesoDispositivo"
                {...register("codigoAccesoDispositivo")}
                placeholder="PIN o contrasena para pruebas"
              />
            ) : (
              <PatternLock
                value={watch("codigoAccesoDispositivo")}
                onChange={(pattern) => setValue("codigoAccesoDispositivo", pattern)}
              />
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Solo si es necesario para realizar pruebas
            </p>
          </div>}

          {/* Teléfono de contacto alternativo */}
          <div>
            <Label htmlFor="telefonoContacto">Teléfono de contacto</Label>
            <Input
              id="telefonoContacto"
              {...register("telefonoContacto")}
              placeholder={selectedClienteObj?.telefono || "Número alternativo"}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {watch("tipoDispositivo") === "CELULAR"
                ? "El cliente deja su celular — ingresá un número alternativo para contactarlo"
                : "Número alternativo para notificaciones y seguimiento (opcional)"
              }
            </p>
          </div>

          {/* Observaciones */}
          <div>
            <Label htmlFor="observaciones">Observaciones</Label>
            <Textarea
              id="observaciones"
              {...register("observaciones")}
              placeholder="Observaciones adicionales..."
              rows={2}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Visible para el cliente en el comprobante y portal de seguimiento.
            </p>
          </div>

          {/* Notas internas */}
          <div>
            <Label htmlFor="notasInternas">Notas internas</Label>
            <Textarea
              id="notasInternas"
              {...register("notasInternas")}
              placeholder="Solo uso interno (no se muestran al cliente)..."
              rows={2}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Uso interno del equipo. No aparece en comprobantes, PDFs ni portal del cliente.
            </p>
          </div>
          </>)}

          {currentStep === 3 && (<>
          {/* Fotos de ingreso */}
          <FotosIngreso
            label={`Fotos del ${term("equipo")} (Ingreso)`}
            fotos={fotos}
            comprimiendo={comprimiendo}
            onFileChange={handleFileChange}
            onRemove={removeFoto}
            onDescripcionChange={updateFotoDescripcion}
          />

          {/* Checklist de Recepción inline */}
          {checklistTemplate && checklistTemplate.items && checklistTemplate.items.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setChecklistOpen(!checklistOpen)}
                className="w-full flex items-center justify-between p-4 bg-muted/50 hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-2 font-medium">
                  <ClipboardCheck className="h-4 w-4" />
                  Checklist de Recepción
                  <span className="text-xs text-muted-foreground font-normal">
                    ({checklistTemplate.nombre})
                  </span>
                </div>
                {checklistOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {checklistOpen && (
                <div className="p-4 space-y-4">
                  {(() => {
                    const itemsByCategory = checklistTemplate.items.reduce((acc: Record<string, any[]>, item: any) => {
                      const cat = item.categoria || "GENERAL"
                      if (!acc[cat]) acc[cat] = []
                      acc[cat].push(item)
                      return acc
                    }, {})
                    const categoriaLabels: Record<string, string> = {
                      CONDICION_FISICA: "Condición Física",
                      ACCESORIOS: "Accesorios Entregados",
                      FUNCIONAL: "Estado Funcional",
                      OTRO: "Otros",
                      GENERAL: "General",
                    }
                    return Object.entries(itemsByCategory).map(([categoria, items]) => (
                      <div key={categoria}>
                        <h4 className="text-sm font-medium text-muted-foreground border-b pb-1 mb-2">
                          {categoriaLabels[categoria] || categoria}
                        </h4>
                        <div className="space-y-1">
                          {(items as any[]).sort((a, b) => a.orden - b.orden).map((item) => {
                            const value = checklistValores[item.id]
                            if (item.tipo === "BOOLEAN") {
                              return (
                                <div key={item.id} className="flex items-center justify-between py-1.5">
                                  <span className="text-sm">
                                    {item.label}
                                    {item.requerido && <span className="text-red-500 ml-1">*</span>}
                                  </span>
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      className={`px-3 py-1 text-xs rounded border transition-colors ${
                                        value === true
                                          ? "bg-primary text-primary-foreground border-primary"
                                          : "hover:bg-muted"
                                      }`}
                                      onClick={() => setChecklistValores(prev => ({ ...prev, [item.id]: true }))}
                                    >
                                      Sí
                                    </button>
                                    <button
                                      type="button"
                                      className={`px-3 py-1 text-xs rounded border transition-colors ${
                                        value === false
                                          ? "bg-primary text-primary-foreground border-primary"
                                          : "hover:bg-muted"
                                      }`}
                                      onClick={() => setChecklistValores(prev => ({ ...prev, [item.id]: false }))}
                                    >
                                      No
                                    </button>
                                  </div>
                                </div>
                              )
                            }
                            if (item.tipo === "TEXT") {
                              return (
                                <div key={item.id} className="py-1.5">
                                  <Label className="text-sm">
                                    {item.label}
                                    {item.requerido && <span className="text-red-500 ml-1">*</span>}
                                  </Label>
                                  <Input
                                    value={(value as string) || ""}
                                    onChange={(e) => setChecklistValores(prev => ({ ...prev, [item.id]: e.target.value }))}
                                    className="h-8 mt-1"
                                  />
                                </div>
                              )
                            }
                            if (item.tipo === "SELECT") {
                              const opciones = item.opciones ? JSON.parse(item.opciones) : []
                              return (
                                <div key={item.id} className="py-1.5">
                                  <Label className="text-sm">
                                    {item.label}
                                    {item.requerido && <span className="text-red-500 ml-1">*</span>}
                                  </Label>
                                  <Select
                                    value={(value as string) || "none"}
                                    onValueChange={(val) => setChecklistValores(prev => ({ ...prev, [item.id]: val === "none" ? "" : val }))}
                                  >
                                    <SelectTrigger className="h-8 mt-1">
                                      <SelectValue placeholder="Seleccionar..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">Seleccionar...</SelectItem>
                                      {opciones.map((opt: string) => (
                                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )
                            }
                            return null
                          })}
                        </div>
                      </div>
                    ))
                  })()}
                  <div>
                    <Label className="text-sm">Observaciones del checklist</Label>
                    <Textarea
                      value={checklistNotas}
                      onChange={(e) => setChecklistNotas(e.target.value)}
                      placeholder="Notas adicionales sobre el estado del equipo..."
                      rows={2}
                      className="mt-1"
                    />
                  </div>
                  <div className="pt-2 border-t">
                    <SignaturePad
                      key={firmaResetKey}
                      label="Firma del Cliente (Conformidad de recepción)"
                      onSignatureChange={(data, mime) => {
                        setChecklistFirma(data)
                        setChecklistFirmaMime(mime)
                      }}
                      disabled={loading}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          </>)}

          <FormActionBar className="flex-wrap justify-between" inDialog={inSheet} alwaysSticky={inSheet}>
            <div>
              {currentStep > 1 && (
                <Button type="button" variant="outline" onClick={handlePrevStep} className="text-sm">
                  Anterior
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="text-sm">
                Cancelar
              </Button>
              {currentStep < totalSteps ? (
                <Button type="button" onClick={handleNextStep}>
                  Siguiente
                </Button>
              ) : (
                <Button type="button" disabled={loading} onClick={handleSubmit(onSubmit)}>
                  {loading ? "Creando..." : "Crear Orden"}
                </Button>
              )}
            </div>
          </FormActionBar>
        </form>
      </CardContent>

      {/* Modal de orden creada con WhatsApp */}
      <OrdenCreadaModal
        open={showOrdenCreadaModal}
        onClose={() => {
          setShowOrdenCreadaModal(false)
          setOrdenCreada(null)
          onSuccess()
        }}
        orden={ordenCreada}
      />

      {/* Upgrade modal contextual: se abre cuando el backend retorna
          PLAN_LIMIT_EXCEEDED al crear órdenes (ver usePlanLimitError). */}
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </Card>
  )
}
