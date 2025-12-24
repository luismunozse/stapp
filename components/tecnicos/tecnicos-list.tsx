"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Wrench, Mail, ClipboardList, CheckCircle } from "lucide-react"

interface Tecnico {
  id: string
  nombre: string
  email: string
  ordenesActivas: number
  ordenesCompletadas: number
}

export function TecnicosList() {
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTecnicos()
  }, [])

  const fetchTecnicos = async () => {
    try {
      const res = await fetch("/api/tecnicos")
      const data = await res.json()
      setTecnicos(data)
    } catch (error) {
      console.error("Error fetching tecnicos:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Cargando...</div>
  }

  if (tecnicos.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No hay técnicos registrados
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {tecnicos.map((tecnico) => (
        <Card key={tecnico.id}>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Wrench className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">{tecnico.nombre}</CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                  <Mail className="h-4 w-4" />
                  {tecnico.email}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Órdenes Activas</span>
              </div>
              <Badge variant="secondary">{tecnico.ordenesActivas}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Completadas</span>
              </div>
              <Badge variant="success">{tecnico.ordenesCompletadas}</Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

