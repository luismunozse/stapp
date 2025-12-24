"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, Search, Phone, Mail, MapPin, Edit, Trash2 } from "lucide-react"
import { ClienteForm } from "./cliente-form"
import { formatDate } from "@/lib/utils"
import type { Cliente } from "@/types"

export function ClientesList() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null)

  const fetchClientes = async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.append("search", search)
      const res = await fetch(`/api/clientes?${params.toString()}`)
      const data = await res.json()
      setClientes(data)
    } catch (error) {
      console.error("Error fetching clientes:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchClientes()
  }, [search])

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro de eliminar este cliente?")) return

    try {
      const res = await fetch(`/api/clientes/${id}`, { method: "DELETE" })
      if (res.ok) {
        fetchClientes()
      }
    } catch (error) {
      console.error("Error deleting cliente:", error)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por nombre, teléfono o DNI..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Cliente
        </Button>
      </div>

      {showForm && (
        <ClienteForm
          cliente={editingCliente}
          onClose={() => {
            setShowForm(false)
            setEditingCliente(null)
          }}
          onSuccess={() => {
            setShowForm(false)
            setEditingCliente(null)
            fetchClientes()
          }}
        />
      )}

      {loading ? (
        <div className="text-center py-8">Cargando...</div>
      ) : clientes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay clientes registrados
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {clientes.map((cliente) => (
            <Card key={cliente.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg">{cliente.nombre}</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingCliente(cliente)
                        setShowForm(true)
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(cliente.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{cliente.telefono}</span>
                </div>
                {cliente.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{cliente.email}</span>
                  </div>
                )}
                {cliente.direccion && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{cliente.direccion}</span>
                  </div>
                )}
                {cliente.dni && (
                  <div className="text-sm text-muted-foreground">
                    DNI: {cliente.dni}
                  </div>
                )}
                <div className="text-xs text-muted-foreground pt-2">
                  Registrado: {formatDate(cliente.createdAt)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

