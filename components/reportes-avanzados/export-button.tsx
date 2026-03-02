"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Download, FileText, Table, Loader2 } from "lucide-react"

interface ExportButtonProps {
  reportType: string
}

export function ExportButton({ reportType }: ExportButtonProps) {
  const [exporting, setExporting] = useState(false)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  const handleExport = async (format: "pdf" | "csv") => {
    setOpen(false)
    setExporting(true)
    try {
      const res = await fetch(
        `/api/export/reportes?type=${reportType}&format=${format}`
      )

      if (!res.ok) {
        throw new Error("Export failed")
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `reporte-${reportType}-${new Date().toISOString().split("T")[0]}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Export error:", err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="outline"
        size="sm"
        disabled={exporting}
        onClick={() => setOpen(!open)}
      >
        {exporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        Exportar
      </Button>

      {open && (
        <div className="absolute right-0 mt-1 w-32 rounded-md border bg-popover shadow-md z-50">
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded-t-md"
            onClick={() => handleExport("csv")}
          >
            <Table className="h-4 w-4" />
            CSV
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded-b-md"
            onClick={() => handleExport("pdf")}
          >
            <FileText className="h-4 w-4" />
            PDF
          </button>
        </div>
      )}
    </div>
  )
}
