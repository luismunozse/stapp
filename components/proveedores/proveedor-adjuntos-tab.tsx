"use client"

import { useRef, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import {
  FileText, FileSpreadsheet, FileImage, File as FileIcon, Trash2, Upload, Download, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface Adjunto {
  id: string
  nombre: string
  descripcion: string | null
  fileUrl: string
  filePath: string
  mime: string | null
  sizeBytes: number | null
  createdAt: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

function fileIcon(mime: string | null) {
  if (!mime) return <FileIcon className="h-5 w-5" />
  if (mime === "application/pdf") return <FileText className="h-5 w-5 text-red-500" />
  if (mime.startsWith("image/")) return <FileImage className="h-5 w-5 text-blue-500" />
  if (mime.includes("excel") || mime.includes("spreadsheet") || mime === "text/csv")
    return <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
  return <FileIcon className="h-5 w-5" />
}

function fmtSize(n: number | null) {
  if (n == null) return ""
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(",")[1] || "")
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function ProveedorAdjuntosTab({ proveedorId }: { proveedorId: string }) {
  const { data: adjuntos = [], mutate } = useSWR<Adjunto[]>(
    `/api/proveedores/${proveedorId}/adjuntos`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [nombre, setNombre] = useState("")
  const [descripcion, setDescripcion] = useState("")

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const base64 = await fileToBase64(file)
      const res = await fetch(`/api/proveedores/${proveedorId}/adjuntos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim() || file.name,
          descripcion: descripcion.trim() || undefined,
          mime: file.type || "application/octet-stream",
          file: base64,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Error al subir archivo")
        return
      }
      toast.success("Archivo subido")
      setNombre("")
      setDescripcion("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      mutate()
    } finally {
      setUploading(false)
    }
  }

  const remove = async (a: Adjunto) => {
    if (!confirm(`¿Eliminar "${a.nombre}"?`)) return
    const res = await fetch(`/api/proveedores/${proveedorId}/adjuntos/${a.id}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Adjunto eliminado")
      mutate()
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm">Subir archivo</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Nombre (opcional)</Label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Lista precios abril 2026"
                disabled={uploading}
              />
            </div>
            <div className="space-y-1">
              <Label>Descripción (opcional)</Label>
              <Input
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Catálogo / lista / contrato..."
                disabled={uploading}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleUpload(f)
              }}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {uploading ? "Subiendo..." : "Elegir archivo"}
            </Button>
            <p className="text-xs text-muted-foreground">
              PDF, imágenes, Excel, CSV. Hasta 10MB.
            </p>
          </div>
        </CardContent>
      </Card>

      {adjuntos.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Sin adjuntos. Subí la lista de precios o catálogo del proveedor.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {adjuntos.map((a) => (
                <div key={a.id} className="flex items-center gap-3 p-3">
                  <div className="shrink-0">{fileIcon(a.mime)}</div>
                  <div className="min-w-0 flex-1">
                    <a
                      href={a.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-sm hover:text-primary truncate block"
                    >
                      {a.nombre}
                    </a>
                    {a.descripcion && <div className="text-xs text-muted-foreground truncate">{a.descripcion}</div>}
                    <div className="text-[11px] text-muted-foreground">
                      {fmtDate(a.createdAt)} · {fmtSize(a.sizeBytes)}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Descargar">
                      <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" download>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(a)} title="Eliminar">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
