"use client"

import { useState } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FormActionBar } from "@/components/ui/form-action-bar"
import { Plus } from "lucide-react"
import { ClienteSelector } from "@/components/cotizaciones/cliente-selector"
import { SignaturePad } from "@/components/firma/signature-pad"
import { compressImage } from "@/lib/image-compression"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"
import { useTerminologia } from "@/contexts/currency-context"
import { useOffline } from "@/contexts/offline-context"
import { useModal } from "@/contexts/modal-context"
import { STORES } from "@/lib/offline/constants"
import { FALLBACK_CONFIG } from "@/lib/tipos-dispositivo-defaults"
import type { Cliente, CampoExtra, AccesorioConfig } from "@/types"
import type { FotoPreview } from "./fotos-ingreso"
import { RecepcionEquipoCard, equipoFormSchema, type EquipoFormValues } from "./recepcion-equipo-card"

const recepcionFormSchema = z.object({
  clienteId: z.string().min(1, "Elegi el cliente"),
  telefonoContacto: z.string().optional(),
  observaciones: z.string().optional(),
  equipos: z.array(equipoFormSchema).min(2, "Carga al menos 2 equipos"),
})

type RecepcionFormData = z.infer<typeof recepcionFormSchema>

/** Estado por equipo que no vive en react-hook-form. */
interface EquipoSideState {
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

const equipoVacio = (): EquipoFormValues => ({
  dispositivo: "",
  tipoDispositivo: "",
  marca: "",
  color: "",
  imei: "",
  problemaReportado: "",
  codigoAccesoDispositivo: "",
})

/** Resultado que devuelve POST /api/recepciones al crear el lote. */
interface RecepcionCreadaResultado {
  recepcion: { id: string; numero: number; codigo: string }
  ordenes: Array<{
    id: string
    numeroOrden: number
    codigoOrden: string
    dispositivo: string
    publicToken: string
  }>
}

export function RecepcionForm() {
  const term = useTerminologia()
  const { offlineFetch } = useOffline()
  const { showError, showInfo } = useModal()
  const { tipos: tiposDispositivo, loading: tiposLoading } = useTiposDispositivo()

  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null)
  const [firma, setFirma] = useState<string | null>(null)
  const [firmaMime, setFirmaMime] = useState<string | null>(null)
  const [terminosAceptados, setTerminosAceptados] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [comprimiendo, setComprimiendo] = useState(false)

  // Al tener valor, el paso siguiente (Task 11) abre RecepcionCreadaModal con
  // este resultado. Ver el seam marcado mas abajo, despues del submit.
  const [resultado, setResultado] = useState<RecepcionCreadaResultado | null>(null)

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
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

  // Resuelve los accesorios disponibles de un tipo de dispositivo fuera de
  // render: no puede usar el hook useTipoDispositivoConfig (viola las reglas
  // de hooks si se llama en un loop de onSubmit), asi que replica solo la
  // resolucion de config -> accesorios que ese hook usa internamente.
  const resolverAccesoriosDisponibles = (codigoTipo: string): AccesorioConfig[] => {
    const tipo = tiposDispositivo.find((t) => t.codigo === codigoTipo)
    const config = tipo?.config && Object.keys(tipo.config).length > 0 ? tipo.config : FALLBACK_CONFIG
    return config.accesorios || FALLBACK_CONFIG.accesorios || []
  }

  const onSubmit = async (data: RecepcionFormData) => {
    if (!terminosAceptados) {
      await showError("El cliente tiene que aceptar los terminos de recepcion")
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        clienteId: data.clienteId,
        telefonoContacto: data.telefonoContacto || undefined,
        observaciones: data.observaciones || undefined,
        firmaCliente: firma || undefined,
        firmaMime: firmaMime || undefined,
        terminosAceptados,
        equipos: data.equipos.map((equipo, i) => {
          // Los accesorios se serializan como LABELS ("Cargador, Cable USB"),
          // no como ids ("cargador, cable"): el alta clasica los guarda asi
          // (orden-form.tsx onSubmit) y el detalle de orden + el comprobante
          // impreso los muestran tal cual se guardaron. Si esto guardara ids
          // crudos, los dos flujos mostrarian el mismo accesorio distinto.
          const disponibles = resolverAccesoriosDisponibles(equipo.tipoDispositivo)
          const accesoriosLabels = sideState[i].accesoriosSeleccionados.map((id) => {
            const acc = disponibles.find((a) => a.id === id)
            return acc ? acc.label : id
          })

          const metadata: Record<string, any> = {}
          for (const [key, val] of Object.entries(sideState[i].camposExtraValues)) {
            if (val !== "" && val !== undefined && val !== null) {
              metadata[key] = val
            }
          }

          const fotos = sideState[i].fotos
            .filter((f) => f.file)
            .map((f) => {
              // base64ToBuffer (lib/storage.ts) hace un Buffer.from(base64, "base64")
              // liso: NO le saca el prefijo "data:image/png;base64,". Si se
              // manda foto.preview completo como `data`, la imagen sube
              // corrupta sin ningun error visible. Hay que separar el prefijo
              // del contenido antes de mandarlo, igual que orden-form.tsx.
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
        }),
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
        await showInfo("Recepcion guardada offline. Se sincronizara automaticamente cuando vuelva la conexion.")
        return
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        await showError(err.error || "Error al crear la recepcion")
        return
      }

      const creada: RecepcionCreadaResultado = await res.json()
      // Seam para Task 11: al setear `resultado`, RecepcionCreadaModal se
      // abre con { recepcion, ordenes } y desde ahi salen impresion,
      // etiquetas y WhatsApp agrupado. Nada de eso se construye aca.
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
              />
            ))}
          </div>

          <Button type="button" variant="outline" onClick={agregarEquipo} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Agregar otro equipo
          </Button>

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

          <FormActionBar className="justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creando..." : `Crear recepcion (${fields.length} equipos)`}
            </Button>
          </FormActionBar>
        </form>

        {resultado && (
          // Seam para Task 11: aca va <RecepcionCreadaModal open resultado={resultado}
          // onClose={() => setResultado(null)} /> con impresion, etiquetas y
          // WhatsApp agrupado. No se implementa en este task a proposito.
          null
        )}
      </CardContent>
    </Card>
  )
}
