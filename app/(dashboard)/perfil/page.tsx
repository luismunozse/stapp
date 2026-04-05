"use client"

import { useSession } from "next-auth/react"
import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/shared/user-avatar"
import { Camera, Trash2, Loader2 } from "lucide-react"
import { toast } from "sonner"

export default function PerfilPage() {
  const { data: session, update } = useSession()
  const [uploading, setUploading] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Usar avatar de session o el que se acaba de subir
  const currentAvatar = avatarUrl ?? session?.user?.avatar ?? null

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 2 * 1024 * 1024) {
      toast.error("El archivo excede el limite de 2MB")
      return
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Tipo de archivo no permitido. Use JPG, PNG o WebP")
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch("/api/users/avatar", { method: "POST", body: formData })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || "Error al subir avatar")
        return
      }

      setAvatarUrl(data.avatar_url)
      await update() // Refrescar session
      toast.success("Avatar actualizado")
    } catch {
      toast.error("Error al subir avatar")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleDelete = async () => {
    setUploading(true)
    try {
      const res = await fetch("/api/users/avatar", { method: "DELETE" })
      if (!res.ok) {
        toast.error("Error al eliminar avatar")
        return
      }

      setAvatarUrl(null)
      await update()
      toast.success("Avatar eliminado")
    } catch {
      toast.error("Error al eliminar avatar")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Mi Perfil</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Gestiona tu informacion personal
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Avatar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <UserAvatar
              src={currentAvatar}
              nombre={session?.user?.name}
              size="lg"
            />
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="mr-2 h-4 w-4" />
                  )}
                  Cambiar foto
                </Button>
                {currentAvatar && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={handleDelete}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                JPG, PNG o WebP. Maximo 2MB.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleUpload}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Informacion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground">Nombre</p>
            <p className="font-medium">{session?.user?.name}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Email</p>
            <p className="font-medium">{session?.user?.email}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Rol</p>
            <p className="font-medium">{session?.user?.role}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
