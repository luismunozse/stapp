"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Copy, ExternalLink, Loader2, QrCode, Save, CheckCircle2, AlertCircle, ImagePlus, Trash2, Upload,
  Plus, X, Truck, Shield, Undo2, CreditCard, Clock, Star, Phone, MapPin, type LucideIcon,
} from "lucide-react"
import { useRef } from "react"
import { toast } from "sonner"
import QRCode from "qrcode"
import type { CatalogoConfig, TrustBadge, TrustBadgeIcon } from "@/types/database"

const TRUST_ICON_MAP: Record<TrustBadgeIcon, LucideIcon> = {
  truck: Truck,
  shield: Shield,
  undo: Undo2,
  card: CreditCard,
  clock: Clock,
  star: Star,
  check: CheckCircle2,
  phone: Phone,
  map: MapPin,
}

const TRUST_ICON_OPTIONS: Array<{ value: TrustBadgeIcon; label: string }> = [
  { value: "truck", label: "Envío" },
  { value: "shield", label: "Garantía" },
  { value: "undo", label: "Devolución" },
  { value: "card", label: "Pago" },
  { value: "clock", label: "Horario" },
  { value: "star", label: "Calidad" },
  { value: "check", label: "Confianza" },
  { value: "phone", label: "Contacto" },
  { value: "map", label: "Ubicación" },
]

const MAX_TRUST_BADGES = 6
import { CatalogoStatsCard } from "./catalogo-stats-card"

export function CatalogoCompartirTab() {
  const [config, setConfig] = useState<CatalogoConfig | null>(null)
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const [slug, setSlug] = useState("")
  const [titulo, setTitulo] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const [colorPrimary, setColorPrimary] = useState("#2563eb")
  const [whatsapp, setWhatsapp] = useState("")
  const [bannerUrl, setBannerUrl] = useState<string | null>(null)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [activo, setActivo] = useState(false)
  const [trustBadges, setTrustBadges] = useState<TrustBadge[]>([])
  const bannerInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/catalogo/config")
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setConfig(data.config)
        setUrl(data.url)
        setSlug(data.config.slug)
        setTitulo(data.config.titulo ?? "")
        setDescripcion(data.config.descripcion ?? "")
        setColorPrimary(data.config.color_primary ?? "#2563eb")
        setWhatsapp(data.config.whatsapp ?? "")
        setBannerUrl(data.config.banner_url ?? null)
        setActivo(data.config.activo)
        setTrustBadges(Array.isArray(data.config.trust_badges) ? data.config.trust_badges : [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error cargando configuración")
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!url || !activo) {
      setQrDataUrl(null)
      return
    }
    QRCode.toDataURL(url, { width: 256, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [url, activo])

  const handleBannerUpload = async (file: File) => {
    setUploadingBanner(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/catalogo/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al subir")
      setBannerUrl(data.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al subir banner")
    } finally {
      setUploadingBanner(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        slug: slug.trim(),
        titulo: titulo.trim() || null,
        descripcion: descripcion.trim() || null,
        color_primary: colorPrimary,
        whatsapp: whatsapp.trim() || null,
        banner_url: bannerUrl,
        trust_badges: trustBadges.filter((b) => b.label.trim().length > 0).slice(0, MAX_TRUST_BADGES),
        activo,
      }
      const res = await fetch("/api/catalogo/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error")
      setConfig(data.config)
      setUrl(data.url)
      toast.success("Configuración guardada")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  const copyUrl = async () => {
    if (!url) return
    await navigator.clipboard.writeText(url)
    toast.success("Link copiado")
  }

  if (loading) {
    return <div className="h-40 bg-muted rounded-md animate-pulse" />
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Configuración</CardTitle>
          <CardDescription>Personalizá cómo se ve tu catálogo público.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
            <div className="flex items-start gap-3">
              {activo ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-orange-500 mt-0.5" />
              )}
              <div>
                <Label htmlFor="activo" className="font-medium">
                  {activo ? "Catálogo público activo" : "Catálogo desactivado"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {activo
                    ? "Cualquiera con el link puede ver tu catálogo."
                    : "Activalo para compartirlo con tus clientes."}
                </p>
              </div>
            </div>
            <Switch id="activo" checked={activo} onCheckedChange={setActivo} />
          </div>

          <div>
            <Label htmlFor="slug">URL del catálogo</Label>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground whitespace-nowrap">/catalogo/</span>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                maxLength={50}
                pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Solo letras minúsculas, números y guiones.</p>
          </div>

          <div>
            <Label htmlFor="titulo">Título</Label>
            <Input id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} placeholder="Ej: Servicios técnicos" />
          </div>

          <div>
            <Label htmlFor="desc">Descripción</Label>
            <Textarea id="desc" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} maxLength={500} />
          </div>

          <div>
            <Label>Banner de portada (opcional)</Label>
            <div className="mt-1.5 flex flex-col gap-2">
              <div className="aspect-[3/1] bg-muted rounded-md overflow-hidden border flex items-center justify-center">
                {bannerUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={bannerUrl} alt="Banner" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <ImagePlus className="h-8 w-8" />
                    <span className="text-xs">Sin banner</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => bannerInputRef.current?.click()}
                  disabled={uploadingBanner}
                  className="gap-1.5"
                >
                  {uploadingBanner ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {bannerUrl ? "Cambiar banner" : "Subir banner"}
                </Button>
                {bannerUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setBannerUrl(null)}
                    className="gap-1.5 text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Quitar
                  </Button>
                )}
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleBannerUpload(f)
                    e.target.value = ""
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">Recomendado: 1200×400px o ratio 3:1.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="color">Color principal</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  id="color"
                  type="color"
                  value={colorPrimary}
                  onChange={(e) => setColorPrimary(e.target.value)}
                  className="h-10 w-14 p-1"
                />
                <Input
                  value={colorPrimary}
                  onChange={(e) => setColorPrimary(e.target.value)}
                  className="flex-1 font-mono"
                  maxLength={7}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="wapp">WhatsApp (opcional)</Label>
              <Input
                id="wapp"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="+5491112345678"
              />
            </div>
          </div>

          <div className="pt-2 border-t">
            <div className="flex items-center justify-between mb-1.5">
              <Label>Sellos de confianza</Label>
              <span className="text-xs text-muted-foreground">{trustBadges.length}/{MAX_TRUST_BADGES}</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Strip que aparece bajo el hero. Refuerza envío / garantía / pago / etc. para subir conversión.
            </p>
            <div className="space-y-2">
              {trustBadges.map((b, i) => {
                const Icon = TRUST_ICON_MAP[b.icon] ?? CheckCircle2
                return (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={b.icon}
                      onChange={(e) =>
                        setTrustBadges((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, icon: e.target.value as TrustBadgeIcon } : x))
                        )
                      }
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      aria-label="Icono"
                    >
                      {TRUST_ICON_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2 flex-1 min-w-0 rounded-md border bg-background px-2">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <Input
                        value={b.label}
                        onChange={(e) =>
                          setTrustBadges((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))
                          )
                        }
                        maxLength={30}
                        placeholder="Ej: Envío a todo el país"
                        className="border-0 shadow-none focus-visible:ring-0 h-9 px-1"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setTrustBadges((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Quitar sello"
                    >
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                )
              })}
              {trustBadges.length < MAX_TRUST_BADGES && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTrustBadges((prev) => [...prev, { icon: "truck", label: "" }])}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Agregar sello
                </Button>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Compartir
          </CardTitle>
          <CardDescription>Link público y código QR.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Link público</Label>
            <div className="flex gap-1 mt-1">
              <Input value={url} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyUrl}>
                <Copy className="h-4 w-4" />
              </Button>
              {activo && (
                <Button variant="outline" size="icon" asChild>
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </div>

          {activo && qrDataUrl ? (
            <div className="flex flex-col items-center gap-2 pt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR" className="rounded-md border" width={256} height={256} />
              <Button variant="outline" size="sm" asChild>
                <a href={qrDataUrl} download={`catalogo-${slug}.png`}>Descargar QR</a>
              </Button>
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground py-6 bg-muted/30 rounded-md">
              {activo ? "Generando QR..." : "Activá el catálogo para generar el QR."}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="lg:col-span-3">
        <CatalogoStatsCard />
      </div>
    </div>
  )
}
