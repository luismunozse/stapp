"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { X, Upload, Download, AlertCircle, CheckCircle2, FileSpreadsheet } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import type { EntityImportType } from "@/types"

interface ImportModalProps {
  entityType: EntityImportType
  onClose: () => void
  onSuccess: () => void
}

interface PreviewRow {
  row: number
  data: any
  valid: boolean
  error?: string
}

interface ImportResults {
  total: number
  success: number
  skipped: number
  errors: number
  errorDetails: Array<{ row: number; error: string; data: any }>
  skippedDetails: Array<{ row: number; reason: string; data: any }>
}

export function ImportModal({ entityType, onClose, onSuccess }: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'select' | 'preview' | 'importing' | 'results'>('select')
  const [file, setFile] = useState<File | null>(null)
  const [fileBase64, setFileBase64] = useState<string>("")
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [totalRows, setTotalRows] = useState(0)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<ImportResults | null>(null)
  const [error, setError] = useState<string>("")

  const entityLabel = entityType === 'CLIENTES' ? 'Clientes' : 'Inventario'

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setError("")

    // Validate file type
    const validTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
    if (!validTypes.includes(selectedFile.type)) {
      setError('Formato de archivo no válido. Use CSV o Excel (.xlsx)')
      return
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024
    if (selectedFile.size > maxSize) {
      setError('El archivo excede el tamaño máximo de 5MB')
      return
    }

    setFile(selectedFile)

    // Convert to base64
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result?.toString().split(',')[1] || ''
      setFileBase64(base64)

      // Get preview
      await getPreview(base64, selectedFile.type)
    }
    reader.readAsDataURL(selectedFile)
  }

  const getPreview = async (base64: string, mime: string) => {
    try {
      const res = await fetch('/api/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: base64,
          mime,
          entityType,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Error al procesar archivo')
        setFile(null)
        setFileBase64('')
        return
      }

      setPreview(data.preview)
      setTotalRows(data.totalRows)
      setStep('preview')
    } catch (error) {
      console.error('Error getting preview:', error)
      setError('Error al procesar archivo')
      setFile(null)
      setFileBase64('')
    }
  }

  const handleImport = async () => {
    if (!file || !fileBase64) return

    setImporting(true)
    setStep('importing')
    setProgress(0)

    // Simulate progress (since we can't track actual progress)
    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + 10, 90))
    }, 500)

    try {
      const res = await fetch('/api/import/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: fileBase64,
          mime: file.type,
          filename: file.name,
          entityType,
        }),
      })

      clearInterval(progressInterval)
      setProgress(100)

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Error al importar')
        setStep('preview')
        return
      }

      setResults(data.results)
      setStep('results')

      if (data.results.success > 0) {
        onSuccess()
      }
    } catch (error) {
      clearInterval(progressInterval)
      console.error('Error importing:', error)
      setError('Error al importar datos')
      setStep('preview')
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = async () => {
    try {
      const res = await fetch(`/api/import/template/${entityType}`)
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `plantilla_${entityType.toLowerCase()}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      setError('Error al descargar plantilla')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Importar {entityLabel}</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-400 px-4 py-3 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Step 1: Select File */}
          {step === 'select' && (
            <div className="space-y-4">
              <div>
                <Label>1. Descarga la plantilla</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Usa nuestra plantilla para asegurar el formato correcto
                </p>
                <Button
                  variant="outline"
                  onClick={downloadTemplate}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Descargar Plantilla CSV
                </Button>
              </div>

              <div>
                <Label>2. Sube tu archivo</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Formatos aceptados: CSV, Excel (.xlsx)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Seleccionar Archivo
                </Button>
              </div>

              <div className="bg-muted p-4 rounded-lg space-y-2">
                <p className="text-sm font-medium">Información importante:</p>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Los registros duplicados serán omitidos automáticamente</li>
                  <li>El archivo debe tener las columnas requeridas</li>
                  <li>Tamaño máximo: 5MB</li>
                </ul>
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {totalRows} registro{totalRows !== 1 ? 's' : ''} encontrado{totalRows !== 1 ? 's' : ''}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {file?.name}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setStep('select')
                    setFile(null)
                    setFileBase64('')
                    setPreview([])
                    setError("")
                  }}
                >
                  Cambiar archivo
                </Button>
              </div>

              <div>
                <Label>Vista previa (primeras 5 filas)</Label>
                <div className="mt-2 border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="px-4 py-2 text-left">Fila</th>
                          <th className="px-4 py-2 text-left">Estado</th>
                          <th className="px-4 py-2 text-left">Datos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((row) => (
                          <tr key={row.row} className="border-t">
                            <td className="px-4 py-2">{row.row}</td>
                            <td className="px-4 py-2">
                              {row.valid ? (
                                <span className="flex items-center gap-1 text-green-600">
                                  <CheckCircle2 className="h-4 w-4" />
                                  Válido
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-red-600">
                                  <AlertCircle className="h-4 w-4" />
                                  Error
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              {row.valid ? (
                                <span className="text-muted-foreground">
                                  {JSON.stringify(row.data).slice(0, 100)}...
                                </span>
                              ) : (
                                <span className="text-red-600 text-xs">
                                  {row.error}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={onClose}>
                  Cancelar
                </Button>
                <Button onClick={handleImport}>
                  Importar {totalRows} registro{totalRows !== 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Importing */}
          {step === 'importing' && (
            <div className="space-y-4 py-8">
              <div className="text-center">
                <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-primary animate-pulse" />
                <p className="font-medium">Importando datos...</p>
                <p className="text-sm text-muted-foreground">
                  Por favor espera mientras procesamos el archivo
                </p>
              </div>
              <Progress value={progress} className="w-full" />
              <p className="text-center text-sm text-muted-foreground">
                {progress}%
              </p>
            </div>
          )}

          {/* Step 4: Results */}
          {step === 'results' && results && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-600" />
                <p className="font-medium text-lg">Importación completada</p>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-2xl font-bold">{results.total}</p>
                    <p className="text-sm text-muted-foreground">Total</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-2xl font-bold text-green-600">{results.success}</p>
                    <p className="text-sm text-muted-foreground">Exitosos</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-2xl font-bold text-yellow-600">{results.skipped}</p>
                    <p className="text-sm text-muted-foreground">Omitidos</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-2xl font-bold text-red-600">{results.errors}</p>
                    <p className="text-sm text-muted-foreground">Errores</p>
                  </CardContent>
                </Card>
              </div>

              {(results.errors > 0 || results.skipped > 0) && (
                <div className="space-y-2">
                  <Label>Detalles</Label>
                  <div className="border rounded-lg max-h-64 overflow-y-auto">
                    {results.errorDetails.map((err) => (
                      <div key={`error-${err.row}`} className="p-3 border-b last:border-0 text-sm">
                        <p className="text-red-600 font-medium">
                          Fila {err.row}: {err.error}
                        </p>
                        <p className="text-muted-foreground text-xs mt-1">
                          {JSON.stringify(err.data)}
                        </p>
                      </div>
                    ))}
                    {results.skippedDetails.map((skip) => (
                      <div key={`skip-${skip.row}`} className="p-3 border-b last:border-0 text-sm">
                        <p className="text-yellow-600 font-medium">
                          Fila {skip.row}: {skip.reason}
                        </p>
                        <p className="text-muted-foreground text-xs mt-1">
                          {JSON.stringify(skip.data)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={onClose}>
                  Cerrar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
