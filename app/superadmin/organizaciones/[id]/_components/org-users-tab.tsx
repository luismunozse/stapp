"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Users, CheckCircle, Loader2, Search, KeyRound, UserX, UserCheck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/utils"
import { toast } from "sonner"
import type { OrganizationUser, UserRole } from "@/types/superadmin"

interface OrgUsersTabProps {
  users: OrganizationUser[]
  onUpdated?: () => void
}

export function OrgUsersTab({ users: initialUsers, onUpdated }: OrgUsersTabProps) {
  const [users, setUsers] = useState(initialUsers)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState("")

  const filteredUsers = searchFilter
    ? users.filter(
        (u) =>
          u.nombre.toLowerCase().includes(searchFilter.toLowerCase()) ||
          u.email.toLowerCase().includes(searchFilter.toLowerCase())
      )
    : users

  async function handleAction(
    userId: string,
    url: string,
    body: Record<string, unknown>,
    onSuccess: (data: { message: string }) => void
  ) {
    setLoadingAction(userId)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Error al realizar la acción")
        return
      }
      toast.success(data.message)
      onSuccess(data)
    } catch {
      toast.error("Error al realizar la acción")
    } finally {
      setLoadingAction(null)
    }
  }

  function handleVerifyEmail(userId: string) {
    handleAction(
      userId,
      `/api/superadmin/users/${userId}/verify-email`,
      {},
      () => {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, email_verified: true } : u
          )
        )
      }
    )
  }

  function handleResetPassword(userId: string) {
    handleAction(
      userId,
      `/api/superadmin/users/${userId}/reset-password`,
      {},
      () => {} // No state change needed
    )
  }

  function handleChangeRole(userId: string, rol: UserRole) {
    handleAction(
      userId,
      `/api/superadmin/users/${userId}/change-role`,
      { rol },
      () => {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, rol } : u))
        )
        onUpdated?.()
      }
    )
  }

  function handleToggleActive(userId: string, activo: boolean) {
    handleAction(
      userId,
      `/api/superadmin/users/${userId}/toggle-active`,
      { activo },
      () => {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, email_verified: activo } : u
          )
        )
      }
    )
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
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Nombre</th>
                <th className="text-left p-3 font-medium">Email</th>
                <th className="text-left p-3 font-medium">Rol</th>
                <th className="text-left p-3 font-medium">Estado</th>
                <th className="text-left p-3 font-medium hidden sm:table-cell">Creado</th>
                <th className="text-left p-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const isLoading = loadingAction === user.id
                return (
                  <tr key={user.id} className="border-b last:border-0">
                    <td className="p-3 font-medium">{user.nombre}</td>
                    <td className="p-3">{user.email}</td>
                    <td className="p-3">
                      <Select
                        value={user.rol}
                        onValueChange={(v) => handleChangeRole(user.id, v as UserRole)}
                        disabled={isLoading}
                      >
                        <SelectTrigger className="h-8 w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADMIN">ADMIN</SelectItem>
                          <SelectItem value="TECNICO">TECNICO</SelectItem>
                          <SelectItem value="VENDEDOR">VENDEDOR</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-3">
                      <Badge variant={user.email_verified ? "default" : "destructive"}>
                        {user.email_verified ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground hidden sm:table-cell">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleResetPassword(user.id)}
                          disabled={isLoading}
                          title="Enviar email de reset de contraseña"
                        >
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <KeyRound className="h-4 w-4" />
                          )}
                        </Button>
                        {user.email_verified ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleActive(user.id, false)}
                            disabled={isLoading}
                            title="Desactivar usuario"
                          >
                            <UserX className="h-4 w-4 text-red-500" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleActive(user.id, true)}
                            disabled={isLoading}
                            title="Activar usuario"
                          >
                            <UserCheck className="h-4 w-4 text-green-500" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
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
