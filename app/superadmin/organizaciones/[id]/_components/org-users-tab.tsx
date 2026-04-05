"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Users, CheckCircle, Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/utils"
import { toast } from "sonner"
import type { OrganizationUser } from "@/types/superadmin"

interface OrgUsersTabProps {
  users: OrganizationUser[]
}

export function OrgUsersTab({ users: initialUsers }: OrgUsersTabProps) {
  const [users, setUsers] = useState(initialUsers)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState("")

  const filteredUsers = searchFilter
    ? users.filter(
        (u) =>
          u.nombre.toLowerCase().includes(searchFilter.toLowerCase()) ||
          u.email.toLowerCase().includes(searchFilter.toLowerCase())
      )
    : users

  async function handleVerifyEmail(userId: string) {
    setVerifyingId(userId)
    try {
      const res = await fetch(`/api/superadmin/users/${userId}/verify-email`, {
        method: "POST",
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || "Error al verificar email")
        return
      }

      toast.success(data.message)
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, email_verified: true } : u
        )
      )
    } catch {
      toast.error("Error al verificar email")
    } finally {
      setVerifyingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Usuarios
        </CardTitle>
        <CardDescription>
          {users.length} usuarios registrados en esta organización
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {users.length > 5 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o email..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-9 max-w-sm"
            />
          </div>
        )}
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Nombre</th>
                <th className="text-left p-3 font-medium">Email</th>
                <th className="text-left p-3 font-medium">Rol</th>
                <th className="text-left p-3 font-medium">Email verificado</th>
                <th className="text-left p-3 font-medium">Creado</th>
                <th className="text-left p-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{user.nombre}</td>
                  <td className="p-3">{user.email}</td>
                  <td className="p-3">
                    <Badge variant="outline">{user.rol}</Badge>
                  </td>
                  <td className="p-3">
                    <Badge variant={user.email_verified ? "default" : "secondary"}>
                      {user.email_verified ? "Sí" : "No"}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="p-3">
                    {!user.email_verified && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleVerifyEmail(user.id)}
                        disabled={verifyingId === user.id}
                      >
                        {verifyingId === user.id ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <CheckCircle className="h-4 w-4 mr-1" />
                        )}
                        Activar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No hay usuarios registrados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
