"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Plus,
  Search,
  Edit,
  Trash2,
  AlertCircle,
  Package,
  Upload,
} from "lucide-react"
import { InventarioForm } from "./inventario-form"
import { ImportModal } from "@/components/import/import-modal"
import { formatCurrency } from "@/lib/utils"
import type { Inventario, TipoDispositivo } from "@/types"
import { useModal } from "@/contexts/modal-context"

const categorias = [
  "Baterías",
  "Pantallas",
  "Carcasas",
  "Teclados",
  "Memoria",
  "Procesadores",
  "Otros",
]

interface InventarioListProps {
  allowImport?: boolean
}

export function InventarioList({ allowImport = true }: InventarioListProps) {
  const { confirm } = useModal()
  const [items, setItems] = useState<Inventario[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [categoria, setCategoria] = useState("")
  const [tipoDispositivo, setTipoDispositivo] = useState<TipoDispositivo | "">("")
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingItem, setEditingItem] = useState<Inventario | null>(null)

  const fetchItems = async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.append("search", search)
      if (categoria) params.append("categoria", categoria)
      if (tipoDispositivo) params.append("tipoDispositivo", tipoDispositivo)

      const res = await fetch(`/api/inventario?${params.toString()}`)
      const data = await res.json()
      setItems(data)
    } catch (error) {
      console.error("Error fetching inventario:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchItems()
  }, [search, categoria, tipoDispositivo])

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: "Eliminar Item",
      description: "¿Estás seguro de eliminar este item del inventario?",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    try {
      const res = await fetch(`/api/inventario/${id}`, { method: "DELETE" })
      if (res.ok) {
        fetchItems()
      }
    } catch (error) {
      console.error("Error deleting item:", error)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Buscar por nombre o código..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            <option value="">Todas las categorías</option>
            {categorias.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
          <Select
            value={tipoDispositivo}
            onChange={(e) => setTipoDispositivo(e.target.value as TipoDispositivo | "")}
          >
            <option value="">Todos los tipos</option>
            <option value="CELULAR">Celular</option>
            <option value="COMPUTADORA">Computadora</option>
            <option value="TABLET">Tablet</option>
            <option value="CONSOLA">Consola</option>
            <option value="SMARTWATCH">Smartwatch</option>
          </Select>
        </div>
        <div className="flex gap-2">
          {allowImport && (
            <Button onClick={() => setShowImport(true)} variant="outline" className="gap-2">
              <Upload className="h-4 w-4" />
              Importar CSV
            </Button>
          )}
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo Item
          </Button>
        </div>
      </div>

      {showForm && (
        <InventarioForm
          item={editingItem}
          onClose={() => {
            setShowForm(false)
            setEditingItem(null)
          }}
          onSuccess={() => {
            setShowForm(false)
            setEditingItem(null)
            fetchItems()
          }}
        />
      )}

      {showImport && (
        <ImportModal
          entityType="INVENTARIO"
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false)
            fetchItems()
          }}
        />
      )}

      {loading ? (
        <div className="text-center py-8">Cargando...</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay items en el inventario
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{item.nombre}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {item.codigo}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingItem(item)
                        setShowForm(true)
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Badge variant="outline">{item.tipoDispositivo}</Badge>
                  <Badge variant="secondary">{item.categoria}</Badge>
                </div>
                {item.descripcion && (
                  <p className="text-sm text-muted-foreground">
                    {item.descripcion}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-muted-foreground">Stock</div>
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4" />
                      <span className={`font-bold ${item.stock < 5 ? "text-destructive" : ""}`}>
                        {item.stock}
                      </span>
                      {item.stock < 5 && (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-muted-foreground">
                      Precio Venta
                    </div>
                    <div className="font-bold">
                      {formatCurrency(item.precioVenta)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

