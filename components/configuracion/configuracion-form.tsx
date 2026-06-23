"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Upload, Trash2, Save, ImageIcon } from "lucide-react"
import { useModal } from "@/contexts/modal-context"
import { NotificationSettings } from "@/components/configuracion/notification-settings"
import { CURRENCY_OPTIONS } from "@/lib/currency"
import { TIMEZONE_OPTIONS } from "@/lib/timezone"
import { COUNTRY_OPTIONS, getCountryConfig } from "@/lib/countries"

interface Config {
  logoData: string | null
  logoMime: string | null
  logoUrl: string | null
  nombreEmpresa: string
  telefono: string | null
  direccion: string | null
  moneda: string
  zonaHoraria: string
}

interface ConfiguracionFormProps {
  allowEdit?: boolean
}

export function ConfiguracionForm({ allowEdit = true }: ConfiguracionFormProps) {
  const { confirm } = useModal()
  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [nombreEmpresa, setNombreEmpresa] = useState("Servicio Técnico")
  const [telefono, setTelefono] = useState("")
  const [direccion, setDireccion] = useState("")
  const [ciudad, setCiudad] = useState("")
  const [provincia, setProvincia] = useState("")
  const [codigoPostal, setCodigoPostal] = useState("")
  const [moneda, setMoneda] = useState("ARS")
  const [zonaHoraria, setZonaHoraria] = useState("America/Argentina/Buenos_Aires")
  const [pais, setPais] = useState("AR")
  const [ivaPorcentaje, setIvaPorcentaje] = useState("0")
  const [cotizacionValidezDias, setCotizacionValidezDias] = useState("30")
  const [cotizacionTerminos, setCotizacionTerminos] = useState("")
  const [recepcionTerminos, setRecepcionTerminos] = useState("")
  const [comprobanteTerminos, setComprobanteTerminos] = useState("")
  const [garantiaDiasDefault, setGarantiaDiasDefault] = useState("30")
  const [politicaAbandonoDiasDefault, setPoliticaAbandonoDiasDefault] = useState("60")
  const [anticipoPorcentajeDefault, setAnticipoPorcentajeDefault] = useState("50")
  const [moduloAgenda, setModuloAgenda] = useState(false)
  const [comisionAplicaSinReparacion, setComisionAplicaSinReparacion] = useState(false)
  const [ivaRegimen, setIvaRegimen] = useState<"EXENTO" | "INCLUIDO" | "ADITIVO">("EXENTO")
  const [ivaTasa, setIvaTasa] = useState("21")
  const [redondeoEfectivo, setRedondeoEfectivo] = useState("0")
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/configuracion")
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
        setNombreEmpresa(data.nombreEmpresa || "Servicio Técnico")
        setTelefono(data.telefono || "")
        setDireccion(data.direccion || "")
        setCiudad(data.ciudad || "")
        setProvincia(data.provincia || "")
        setCodigoPostal(data.codigoPostal || "")
        setPais(data.pais || "AR")
        setMoneda(data.moneda || "ARS")
        setZonaHoraria(data.zonaHoraria || "America/Argentina/Buenos_Aires")
        setIvaPorcentaje(String(data.ivaPorcentaje ?? 0))
        setCotizacionValidezDias(String(data.cotizacionValidezDias ?? 30))
        setCotizacionTerminos(data.cotizacionTerminos || "")
        setRecepcionTerminos(data.recepcionTerminos || "")
        setComprobanteTerminos(data.comprobanteTerminos || "")
        setGarantiaDiasDefault(String(data.garantiaDiasDefault ?? 30))
        setPoliticaAbandonoDiasDefault(String(data.politicaAbandonoDiasDefault ?? 60))
        setAnticipoPorcentajeDefault(String(data.anticipoPorcentajeDefault ?? 50))
        setModuloAgenda(!!data.moduloAgenda)
        setComisionAplicaSinReparacion(!!data.comisionAplicaSinReparacion)
        setIvaRegimen(data.ivaRegimen ?? "EXENTO")
        setIvaTasa(String(data.ivaTasa ?? 21))
        setRedondeoEfectivo(String(data.redondeoEfectivo ?? 0))
        // Usar logoUrl si existe, o logoData para compatibilidad
        if (data.logoUrl) {
          setPreview(data.logoUrl)
        } else if (data.logoData && data.logoMime) {
          setPreview(`data:${data.logoMime};base64,${data.logoData}`)
        }
      }
    } catch (error) {
      console.error("Error fetching config:", error)
    } finally {
      setLoading(false)
    }
  }

  const compressImage = (file: File, maxWidth = 400, quality = 0.8): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement("canvas")
          let w = img.width
          let h = img.height
          if (w > maxWidth) {
            h = Math.round((h * maxWidth) / w)
            w = maxWidth
          }
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext("2d")!
          ctx.drawImage(img, 0, 0, w, h)
          // Usar PNG si es transparente, JPEG si no
          const isPng = file.type === "image/png"
          const outputType = isPng ? "image/png" : "image/jpeg"
          const dataUrl = canvas.toDataURL(outputType, isPng ? undefined : quality)
          resolve(dataUrl)
        }
        img.onerror = reject
        img.src = event.target?.result as string
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      setMessage({ type: "error", text: "Por favor selecciona una imagen válida" })
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: "error", text: "La imagen es demasiado grande (máximo 5MB)" })
      return
    }

    try {
      const compressed = await compressImage(file)
      setPreview(compressed)
      setMessage(null)
    } catch {
      setMessage({ type: "error", text: "Error al procesar la imagen" })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      let logoData = null
      let logoMime = null

      if (preview && preview.startsWith("data:")) {
        const [header, data] = preview.split(",")
        logoMime = header.split(":")[1].split(";")[0]
        logoData = data
      }

      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoData, logoMime, nombreEmpresa, telefono, direccion, ciudad, provincia, codigoPostal, moneda, zonaHoraria, ivaPorcentaje, cotizacionValidezDias, cotizacionTerminos, recepcionTerminos, comprobanteTerminos, garantiaDiasDefault, politicaAbandonoDiasDefault, anticipoPorcentajeDefault, pais, moduloAgenda, comisionAplicaSinReparacion, ivaRegimen, ivaTasa, redondeoEfectivo }),
      })

      if (res.ok) {
        setMessage({ type: "success", text: "Configuración guardada exitosamente" })
        fetchConfig()
        // Notificar al sidebar que las features de la org cambiaron
        // (ej: activar/desactivar módulo agenda muestra/oculta el item del menú)
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("stapp:org-features-updated"))
        }
      } else {
        const error = await res.json()
        setMessage({ type: "error", text: error.error || "Error al guardar" })
      }
    } catch (error) {
      console.error("Error saving config:", error)
      setMessage({ type: "error", text: "Error al guardar configuración" })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteLogo = async () => {
    const confirmed = await confirm({
      title: "Eliminar Logo",
      description: "¿Estás seguro de eliminar el logo? Se mostrará el texto por defecto.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "warning",
    })

    if (!confirmed) return

    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/configuracion", { method: "DELETE" })
      if (res.ok) {
        setPreview(null)
        setMessage({ type: "success", text: "Logo eliminado" })
        fetchConfig()
      }
    } catch (error) {
      console.error("Error deleting logo:", error)
      setMessage({ type: "error", text: "Error al eliminar logo" })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-2xl">
      {message && (
        <div
          className={`px-3 sm:px-4 py-2 sm:py-3 rounded text-sm ${
            message.type === "success"
              ? "bg-success-50 dark:bg-success/15 border border-success-200 dark:border-success/30 text-success-600 dark:text-success-500"
              : "bg-destructive/10 border border-destructive/30 text-destructive"
          }`}
        >
          {message.text}
        </div>
      )}

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Logo de la Empresa</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Se mostrará en el login, navegación y comprobantes PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-16 h-16 sm:w-24 sm:h-24 border-2 border-dashed border-border rounded-lg flex items-center justify-center overflow-hidden bg-muted shrink-0">
              {preview ? (
                <img
                  src={preview}
                  alt="Logo preview"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <ImageIcon className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={!allowEdit}
              >
                <Upload className="mr-2 h-4 w-4" />
                Subir Logo
              </Button>
              {preview && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteLogo}
                  disabled={saving || !allowEdit}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            PNG, JPG, GIF, WebP. Máximo 2MB.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Datos de la Empresa</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Se mostrarán en la app y en los comprobantes PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
          <div>
            <Label htmlFor="nombreEmpresa" className="text-sm">Nombre de la Empresa</Label>
            <Input
              id="nombreEmpresa"
              value={nombreEmpresa}
              onChange={(e) => setNombreEmpresa(e.target.value)}
              placeholder="Servicio Técnico"
              disabled={!allowEdit}
            />
          </div>
          <div>
            <Label htmlFor="telefono" className="text-sm">Teléfono</Label>
            <Input
              id="telefono"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="+54 11 1234-5678"
              disabled={!allowEdit}
            />
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Se mostrará en los comprobantes PDF
            </p>
          </div>
          <div>
            <Label htmlFor="direccion" className="text-sm">Dirección</Label>
            <Input
              id="direccion"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Av. Principal 123"
              disabled={!allowEdit}
            />
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Se mostrará en los comprobantes PDF
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="ciudad" className="text-sm">Ciudad</Label>
              <Input
                id="ciudad"
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
                placeholder="Córdoba"
                disabled={!allowEdit}
              />
            </div>
            <div>
              <Label htmlFor="provincia" className="text-sm">Provincia / Estado</Label>
              <Input
                id="provincia"
                value={provincia}
                onChange={(e) => setProvincia(e.target.value)}
                placeholder="Córdoba"
                disabled={!allowEdit}
              />
            </div>
            <div>
              <Label htmlFor="codigoPostal" className="text-sm">Código Postal</Label>
              <Input
                id="codigoPostal"
                value={codigoPostal}
                onChange={(e) => setCodigoPostal(e.target.value)}
                placeholder="5000"
                disabled={!allowEdit}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">País</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            El país determina la moneda, zona horaria, formato de teléfono e identificación fiscal por defecto.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div>
            <Label htmlFor="pais" className="text-sm">País</Label>
            <Select
              value={pais}
              onValueChange={(val) => {
                setPais(val)
                // Auto-completar defaults del país
                const countryConfig = getCountryConfig(val)
                setMoneda(countryConfig.defaultCurrency)
                setZonaHoraria(countryConfig.defaultTimezone)
              }}
              disabled={!allowEdit}
            >
              <SelectTrigger id="pais">
                <SelectValue placeholder="Seleccionar país" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Moneda</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Moneda utilizada para montos, facturas y comprobantes.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div>
            <Label htmlFor="moneda" className="text-sm">Moneda</Label>
            <Select value={moneda} onValueChange={setMoneda} disabled={!allowEdit}>
              <SelectTrigger id="moneda">
                <SelectValue placeholder="Seleccionar moneda" />
              </SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Se utilizará en toda la app, PDFs y notificaciones
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Zona Horaria</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Zona horaria del taller. Se utiliza para mostrar fechas y horas correctamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div>
            <Label htmlFor="zonaHoraria" className="text-sm">Zona Horaria</Label>
            <Select value={zonaHoraria} onValueChange={setZonaHoraria} disabled={!allowEdit}>
              <SelectTrigger id="zonaHoraria">
                <SelectValue placeholder="Seleccionar zona horaria" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label} ({opt.offset})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Se utilizara en toda la app, PDFs y notificaciones
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Módulos opcionales</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Activá funcionalidades específicas según tu rubro.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border hover:bg-accent/40 transition-colors">
            <input
              type="checkbox"
              checked={moduloAgenda}
              onChange={(e) => setModuloAgenda(e.target.checked)}
              disabled={!allowEdit}
              className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Agenda de turnos</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Para servicios on-site (gastronomía, refrigeración, heladería, fabricadoras de helado).
                Permite agendar visitas, retiros y entregas antes de crear la orden.
                Al activarse, aparece la sección <strong>Agenda</strong> en el menú.
              </div>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border hover:bg-accent/40 transition-colors mt-2">
            <input
              type="checkbox"
              checked={comisionAplicaSinReparacion}
              onChange={(e) => setComisionAplicaSinReparacion(e.target.checked)}
              disabled={!allowEdit}
              className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Pagar comisión en órdenes sin reparación</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Si está activo, las órdenes ENTREGADO_SIN_REPARACION generan comisión para el técnico y se deducen en el P&L.
              </div>
            </div>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Facturación / IVA</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Configuración fiscal para el Punto de Venta. Afecta cómo se calcula y muestra el IVA en tickets y totales.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
          <div>
            <Label htmlFor="ivaRegimen" className="text-sm">Régimen de IVA</Label>
            <Select
              value={ivaRegimen}
              onValueChange={(val) => setIvaRegimen(val as "EXENTO" | "INCLUIDO" | "ADITIVO")}
              disabled={!allowEdit}
            >
              <SelectTrigger id="ivaRegimen">
                <SelectValue placeholder="Seleccionar régimen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EXENTO">Exento</SelectItem>
                <SelectItem value="INCLUIDO">IVA incluido en el precio</SelectItem>
                <SelectItem value="ADITIVO">IVA se suma</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              IVA incluido = el precio ya tiene IVA, se discrimina en el ticket. IVA se suma = se agrega al total.
            </p>
          </div>
          {ivaRegimen !== "EXENTO" && (
            <div>
              <Label htmlFor="ivaTasa" className="text-sm">Tasa de IVA (%)</Label>
              <Input
                id="ivaTasa"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={ivaTasa}
                onChange={(e) => setIvaTasa(e.target.value)}
                placeholder="21"
                disabled={!allowEdit}
              />
            </div>
          )}
          <div>
            <Label htmlFor="redondeoEfectivo" className="text-sm">Redondeo de efectivo</Label>
            <Select
              value={redondeoEfectivo}
              onValueChange={setRedondeoEfectivo}
              disabled={!allowEdit}
            >
              <SelectTrigger id="redondeoEfectivo">
                <SelectValue placeholder="Sin redondeo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Sin redondeo</SelectItem>
                <SelectItem value="10">$ 10</SelectItem>
                <SelectItem value="50">$ 50</SelectItem>
                <SelectItem value="100">$ 100</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Redondea el total al múltiplo más cercano cuando el pago es en efectivo.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Cotizaciones / Presupuestos</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Valores por defecto al crear nuevas cotizaciones.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
          <div>
            <Label htmlFor="ivaPorcentaje" className="text-sm">IVA (%)</Label>
            <Select value={ivaPorcentaje} onValueChange={setIvaPorcentaje} disabled={!allowEdit}>
              <SelectTrigger id="ivaPorcentaje">
                <SelectValue placeholder="Seleccionar IVA" />
              </SelectTrigger>
              <SelectContent>
                {getCountryConfig(pais).ivaOptions.map((opt) => (
                  <SelectItem key={opt} value={String(opt)}>
                    {opt === 0 ? "0% (Sin IVA)" : `${opt}%`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Se aplicará por defecto en nuevas cotizaciones
            </p>
          </div>
          <div>
            <Label htmlFor="cotizacionValidezDias" className="text-sm">Validez por defecto (días)</Label>
            <Input
              id="cotizacionValidezDias"
              type="number"
              min="1"
              value={cotizacionValidezDias}
              onChange={(e) => setCotizacionValidezDias(e.target.value)}
              placeholder="30"
              disabled={!allowEdit}
            />
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Días de validez que se asignan automáticamente
            </p>
          </div>
          <div>
            <Label htmlFor="cotizacionTerminos" className="text-sm">Términos y Condiciones</Label>
            <Textarea
              id="cotizacionTerminos"
              value={cotizacionTerminos}
              onChange={(e) => setCotizacionTerminos(e.target.value)}
              placeholder="Ej: Los precios no incluyen repuestos adicionales. Garantía de 30 días sobre mano de obra..."
              rows={4}
              disabled={!allowEdit}
            />
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Se incluirán por defecto en nuevas cotizaciones y PDFs
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t">
            <div>
              <Label htmlFor="garantiaDiasDefault" className="text-sm">Garantía por defecto (días)</Label>
              <Input
                id="garantiaDiasDefault"
                type="number"
                min="0"
                value={garantiaDiasDefault}
                onChange={(e) => setGarantiaDiasDefault(e.target.value)}
                placeholder="30"
                disabled={!allowEdit}
              />
            </div>
            <div>
              <Label htmlFor="anticipoPorcentajeDefault" className="text-sm">Anticipo por defecto (%)</Label>
              <Input
                id="anticipoPorcentajeDefault"
                type="number"
                min="0"
                max="100"
                value={anticipoPorcentajeDefault}
                onChange={(e) => setAnticipoPorcentajeDefault(e.target.value)}
                placeholder="50"
                disabled={!allowEdit}
              />
            </div>
            <div>
              <Label htmlFor="politicaAbandonoDiasDefault" className="text-sm">Plazo de retiro (días)</Label>
              <Input
                id="politicaAbandonoDiasDefault"
                type="number"
                min="0"
                value={politicaAbandonoDiasDefault}
                onChange={(e) => setPoliticaAbandonoDiasDefault(e.target.value)}
                placeholder="60"
                disabled={!allowEdit}
              />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground sm:col-span-3 mt-1">
              Defaults técnicos sugeridos al crear nuevos presupuestos.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Comprobante de Recepcion</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Terminos y condiciones que aparecen en el comprobante PDF al recibir un equipo.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
          <div>
            <Label htmlFor="recepcionTerminos" className="text-sm">Terminos y Condiciones</Label>
            <Textarea
              id="recepcionTerminos"
              value={recepcionTerminos}
              onChange={(e) => setRecepcionTerminos(e.target.value)}
              placeholder={"1. Conserve este comprobante para retirar su equipo. El plazo de retiro es de 30 dias.\n2. No nos hacemos responsables por datos perdidos. Realice backup antes de entregar el equipo.\n3. Al firmar, el cliente declara haber revisado el estado del equipo al momento de la entrega.\n4. El presupuesto puede variar segun el diagnostico final del equipo."}
              rows={5}
              disabled={!allowEdit}
            />
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Escriba cada termino en una linea separada. Si se deja vacio se usaran los terminos por defecto.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Comprobante Termico (Impresora)</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Terminos y condiciones que se imprimen al pie del ticket termico de la orden de servicio.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
          <div>
            <Label htmlFor="comprobanteTerminos" className="text-sm">Terminos y Condiciones</Label>
            <Textarea
              id="comprobanteTerminos"
              value={comprobanteTerminos}
              onChange={(e) => setComprobanteTerminos(e.target.value)}
              placeholder={"1. Conserve este comprobante para retirar su equipo.\n2. No nos responsabilizamos por datos perdidos.\n3. El presupuesto puede variar segun el diagnostico.\n4. Equipos sin retirar a los 60 dias seran considerados abandonados."}
              rows={5}
              disabled={!allowEdit}
            />
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Se imprime al final del ticket. Si se deja vacio no aparece ninguna seccion de terminos.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving || !allowEdit} className="w-full sm:w-auto">
        <Save className="mr-2 h-4 w-4" />
        {saving ? "Guardando..." : "Guardar Cambios"}
      </Button>

      {/* Configuración de notificaciones - se guarda por separado */}
      <NotificationSettings allowEdit={allowEdit} />
    </div>
  )
}
