"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Save,
  Loader2,
  Plus,
  X,
  Eye,
  EyeOff,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import type { TipoDispositivoConfig, CampoExtra, AccesorioConfig } from "@/types"

interface TipoConfigEditorProps {
  tipoId: string
  tipoNombre: string
  config: TipoDispositivoConfig
  onSave: (config: TipoDispositivoConfig) => Promise<void>
  onClose: () => void
}

const CAMPO_EXTRA_TIPOS = [
  { value: "text", label: "Texto libre" },
  { value: "select", label: "Lista desplegable" },
  { value: "buttons", label: "Botones" },
  { value: "counter", label: "Contador numerico" },
]

export function TipoConfigEditor({ tipoId, tipoNombre, config, onSave, onClose }: TipoConfigEditorProps) {
  const [saving, setSaving] = useState(false)

  // Campos visibility
  const [imeiVisible, setImeiVisible] = useState(config.campos?.imei?.visible !== false)
  const [imeiLabel, setImeiLabel] = useState(config.campos?.imei?.label || "Numero de Serie")
  const [imeiPlaceholder, setImeiPlaceholder] = useState(config.campos?.imei?.placeholder || "")
  const [passwordVisible, setPasswordVisible] = useState(config.campos?.password?.visible !== false)
  const [colorVisible, setColorVisible] = useState(config.campos?.color?.visible !== false)
  const [marcaVisible, setMarcaVisible] = useState(config.campos?.marca?.visible !== false)

  // Lists
  const [accesorios, setAccesorios] = useState<AccesorioConfig[]>(config.accesorios || [])
  const [nuevoAccesorioId, setNuevoAccesorioId] = useState("")
  const [nuevoAccesorioLabel, setNuevoAccesorioLabel] = useState("")

  const [marcas, setMarcas] = useState<string[]>(config.marcas || [])
  const [nuevaMarca, setNuevaMarca] = useState("")

  const [problemas, setProblemas] = useState<string[]>(config.problemasComunes || [])
  const [nuevoProblema, setNuevoProblema] = useState("")

  const [categoriasInventario, setCategoriasInventario] = useState<string[]>(config.categoriasInventario || [])
  const [nuevaCategoria, setNuevaCategoria] = useState("")

  // Campos extra
  const [camposExtra, setCamposExtra] = useState<CampoExtra[]>(config.camposExtra || [])

  // Section info
  const [infoTitle, setInfoTitle] = useState(config.infoSectionTitle || "")
  const [infoIcon, setInfoIcon] = useState(config.infoSectionIcon || "")
  const [infoColor, setInfoColor] = useState(config.infoSectionColor || "")

  const handleSave = async () => {
    setSaving(true)
    try {
      const newConfig: TipoDispositivoConfig = {
        campos: {
          imei: { visible: imeiVisible, label: imeiLabel, placeholder: imeiPlaceholder },
          password: { visible: passwordVisible },
          color: { visible: colorVisible },
          marca: { visible: marcaVisible },
        },
        accesorios,
        marcas,
        problemasComunes: problemas,
        categoriasInventario: categoriasInventario.length > 0 ? categoriasInventario : undefined,
        camposExtra,
        ...(infoTitle && { infoSectionTitle: infoTitle }),
        ...(infoIcon && { infoSectionIcon: infoIcon }),
        ...(infoColor && { infoSectionColor: infoColor }),
      }
      await onSave(newConfig)
    } finally {
      setSaving(false)
    }
  }

  // --- Accesorios helpers ---
  const addAccesorio = () => {
    if (!nuevoAccesorioLabel.trim()) return
    const id = nuevoAccesorioId.trim() || nuevoAccesorioLabel.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
    setAccesorios((prev) => [...prev, { id, label: nuevoAccesorioLabel.trim() }])
    setNuevoAccesorioId("")
    setNuevoAccesorioLabel("")
  }

  // --- Marcas helpers ---
  const addMarca = () => {
    if (!nuevaMarca.trim() || marcas.includes(nuevaMarca.trim())) return
    setMarcas((prev) => [...prev, nuevaMarca.trim()])
    setNuevaMarca("")
  }

  // --- Problemas helpers ---
  const addProblema = () => {
    if (!nuevoProblema.trim() || problemas.includes(nuevoProblema.trim())) return
    setProblemas((prev) => [...prev, nuevoProblema.trim()])
    setNuevoProblema("")
  }

  // --- Categorias inventario helpers ---
  const addCategoria = () => {
    if (!nuevaCategoria.trim() || categoriasInventario.includes(nuevaCategoria.trim())) return
    setCategoriasInventario((prev) => [...prev, nuevaCategoria.trim()])
    setNuevaCategoria("")
  }

  // --- Campos extra helpers ---
  const addCampoExtra = () => {
    setCamposExtra((prev) => [
      ...prev,
      { key: `campo_${Date.now()}`, label: "", tipo: "text" as const },
    ])
  }

  const updateCampoExtra = (index: number, updates: Partial<CampoExtra>) => {
    setCamposExtra((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...updates } : c))
    )
  }

  const removeCampoExtra = (index: number) => {
    setCamposExtra((prev) => prev.filter((_, i) => i !== index))
  }

  const moveCampoExtra = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= camposExtra.length) return
    const items = [...camposExtra]
    const temp = items[index]
    items[index] = items[newIndex]
    items[newIndex] = temp
    setCamposExtra(items)
  }

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Configuracion de {tipoNombre}</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Campos de visibilidad */}
        <div>
          <h4 className="text-sm font-medium mb-3">Visibilidad de campos</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* IMEI */}
            <div className="space-y-2 border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">IMEI/Serial</span>
                <button
                  type="button"
                  onClick={() => setImeiVisible(!imeiVisible)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {imeiVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>
              {imeiVisible && (
                <>
                  <Input
                    value={imeiLabel}
                    onChange={(e) => setImeiLabel(e.target.value)}
                    placeholder="Label"
                    className="h-7 text-xs"
                  />
                  <Input
                    value={imeiPlaceholder}
                    onChange={(e) => setImeiPlaceholder(e.target.value)}
                    placeholder="Placeholder"
                    className="h-7 text-xs"
                  />
                </>
              )}
            </div>

            {/* Password */}
            <div className="flex items-center justify-between border rounded-lg p-3">
              <span className="text-sm font-medium">Contrasena</span>
              <button
                type="button"
                onClick={() => setPasswordVisible(!passwordVisible)}
                className="text-muted-foreground hover:text-foreground"
              >
                {passwordVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>

            {/* Color */}
            <div className="flex items-center justify-between border rounded-lg p-3">
              <span className="text-sm font-medium">Color</span>
              <button
                type="button"
                onClick={() => setColorVisible(!colorVisible)}
                className="text-muted-foreground hover:text-foreground"
              >
                {colorVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>

            {/* Marca */}
            <div className="flex items-center justify-between border rounded-lg p-3">
              <span className="text-sm font-medium">Marca</span>
              <button
                type="button"
                onClick={() => setMarcaVisible(!marcaVisible)}
                className="text-muted-foreground hover:text-foreground"
              >
                {marcaVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Campos extra */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium">Campos adicionales</h4>
            <Button size="sm" variant="outline" onClick={addCampoExtra}>
              <Plus className="mr-1 h-3 w-3" /> Campo
            </Button>
          </div>
          {camposExtra.length > 0 && (
            <div className="space-y-3">
              {camposExtra.map((campo, idx) => (
                <div key={idx} className="border rounded-lg p-3 space-y-2 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveCampoExtra(idx, "up")}
                        disabled={idx === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCampoExtra(idx, "down")}
                        disabled={idx === camposExtra.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 flex-1">
                      <Input
                        value={campo.key}
                        onChange={(e) => updateCampoExtra(idx, { key: e.target.value })}
                        placeholder="clave"
                        className="h-8 text-xs"
                      />
                      <Input
                        value={campo.label}
                        onChange={(e) => updateCampoExtra(idx, { label: e.target.value })}
                        placeholder="Nombre visible"
                        className="h-8 text-xs"
                      />
                      <Select
                        value={campo.tipo}
                        onValueChange={(v) => updateCampoExtra(idx, { tipo: v as CampoExtra["tipo"] })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CAMPO_EXTRA_TIPOS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCampoExtra(idx)}
                      className="text-destructive hover:text-destructive/80"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Options for select/buttons types */}
                  {(campo.tipo === "select" || campo.tipo === "buttons") && (
                    <div className="pl-6">
                      <Label className="text-xs text-muted-foreground">Opciones (separadas por coma)</Label>
                      <Input
                        value={(campo.opciones || []).join(", ")}
                        onChange={(e) => updateCampoExtra(idx, {
                          opciones: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        })}
                        placeholder="Opcion 1, Opcion 2, Opcion 3"
                        className="h-8 text-xs mt-1"
                      />
                    </div>
                  )}

                  {/* Min/Max for counter */}
                  {campo.tipo === "counter" && (
                    <div className="pl-6 flex gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">Min</Label>
                        <Input
                          type="number"
                          value={campo.min ?? 0}
                          onChange={(e) => updateCampoExtra(idx, { min: Number(e.target.value) })}
                          className="h-8 text-xs w-20 mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Max</Label>
                        <Input
                          type="number"
                          value={campo.max ?? 4}
                          onChange={(e) => updateCampoExtra(idx, { max: Number(e.target.value) })}
                          className="h-8 text-xs w-20 mt-1"
                        />
                      </div>
                    </div>
                  )}

                  {/* Special flags */}
                  <div className="pl-6 flex gap-4">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={campo.usarComoDispositivo || false}
                        onChange={(e) => updateCampoExtra(idx, { usarComoDispositivo: e.target.checked || undefined })}
                        className="h-3 w-3"
                      />
                      Usar como nombre de dispositivo
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
          {camposExtra.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Sin campos adicionales. Agrega campos como procesador, RAM, etc.
            </p>
          )}
        </div>

        {/* Info section styling (only if there are extra fields) */}
        {camposExtra.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3">Seccion de informacion adicional</h4>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Titulo</Label>
                <Input
                  value={infoTitle}
                  onChange={(e) => setInfoTitle(e.target.value)}
                  placeholder="Informacion del Equipo"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Icono (emoji)</Label>
                <Input
                  value={infoIcon}
                  onChange={(e) => setInfoIcon(e.target.value)}
                  placeholder="Ej: o similar"
                  className="h-8 text-xs"
                  maxLength={4}
                />
              </div>
              <div>
                <Label className="text-xs">Color</Label>
                <Select value={infoColor || ""} onValueChange={setInfoColor}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Sin color" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blue">Azul</SelectItem>
                    <SelectItem value="purple">Violeta</SelectItem>
                    <SelectItem value="green">Verde</SelectItem>
                    <SelectItem value="orange">Naranja</SelectItem>
                    <SelectItem value="red">Rojo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* Accesorios */}
        <div>
          <h4 className="text-sm font-medium mb-3">
            Accesorios <Badge variant="secondary" className="ml-1">{accesorios.length}</Badge>
          </h4>
          <div className="flex flex-wrap gap-1 mb-2">
            {accesorios.map((acc, i) => (
              <span
                key={acc.id}
                className="inline-flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs"
              >
                {acc.label}
                <button
                  type="button"
                  onClick={() => setAccesorios((prev) => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={nuevoAccesorioLabel}
              onChange={(e) => setNuevoAccesorioLabel(e.target.value)}
              placeholder="Nombre del accesorio"
              className="h-8 text-xs flex-1"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAccesorio() } }}
            />
            <Button size="sm" variant="outline" onClick={addAccesorio} className="h-8">
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Marcas */}
        <div>
          <h4 className="text-sm font-medium mb-3">
            Marcas <Badge variant="secondary" className="ml-1">{marcas.length}</Badge>
          </h4>
          <div className="flex flex-wrap gap-1 mb-2">
            {marcas.map((m, i) => (
              <span
                key={m}
                className="inline-flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs"
              >
                {m}
                <button
                  type="button"
                  onClick={() => setMarcas((prev) => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={nuevaMarca}
              onChange={(e) => setNuevaMarca(e.target.value)}
              placeholder="Nombre de marca"
              className="h-8 text-xs flex-1"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMarca() } }}
            />
            <Button size="sm" variant="outline" onClick={addMarca} className="h-8">
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Problemas comunes */}
        <div>
          <h4 className="text-sm font-medium mb-3">
            Problemas comunes <Badge variant="secondary" className="ml-1">{problemas.length}</Badge>
          </h4>
          <div className="flex flex-wrap gap-1 mb-2">
            {problemas.map((p, i) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs"
              >
                {p}
                <button
                  type="button"
                  onClick={() => setProblemas((prev) => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={nuevoProblema}
              onChange={(e) => setNuevoProblema(e.target.value)}
              placeholder="Problema comun"
              className="h-8 text-xs flex-1"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProblema() } }}
            />
            <Button size="sm" variant="outline" onClick={addProblema} className="h-8">
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Categorias de inventario */}
        <div>
          <h4 className="text-sm font-medium mb-3">
            Categorias de inventario <Badge variant="secondary" className="ml-1">{categoriasInventario.length}</Badge>
          </h4>
          <p className="text-xs text-muted-foreground mb-2">
            Subcategorias de repuestos/insumos para este tipo de dispositivo (ej: Cartuchos, Toner, Fusor)
          </p>
          <div className="flex flex-wrap gap-1 mb-2">
            {categoriasInventario.map((c, i) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs"
              >
                {c}
                <button
                  type="button"
                  onClick={() => setCategoriasInventario((prev) => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={nuevaCategoria}
              onChange={(e) => setNuevaCategoria(e.target.value)}
              placeholder="Nueva categoria"
              className="h-8 text-xs flex-1"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCategoria() } }}
            />
            <Button size="sm" variant="outline" onClick={addCategoria} className="h-8">
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
