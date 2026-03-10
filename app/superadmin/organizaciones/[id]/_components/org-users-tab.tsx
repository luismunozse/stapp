"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { OrganizationUser } from "@/types/superadmin"

interface OrgUsersTabProps {
  users: OrganizationUser[]
}

export function OrgUsersTab({ users }: OrgUsersTabProps) {
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
      <CardContent>
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Nombre</th>
                <th className="text-left p-3 font-medium">Email</th>
                <th className="text-left p-3 font-medium">Rol</th>
                <th className="text-left p-3 font-medium">Email verificado</th>
                <th className="text-left p-3 font-medium">Creado</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
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
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
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
