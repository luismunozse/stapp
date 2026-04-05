"use client"

import { useSession } from "next-auth/react"
import { useState, useRef, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/shared/user-avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PersonalInfo } from "@/components/perfil/personal-info"
import { ChangePassword } from "@/components/perfil/change-password"
import { SecuritySettings } from "@/components/configuracion/security-settings"
import { Camera, Trash2, Loader2, User, Shield, Info } from "lucide-react"
import { toast } from "sonner"

interface ProfileData {
  nombre: string
  email: string
  rol: string
  hasPassword: boolean
  totpEnabled: boolean
  avatarUrl: string | null
}

export default function PerfilPage() {
  const { data: session, update } = useSession()
  const [uploading, setUploading] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch("/api/users/profile")
      .then((res) => res.json())
      .then((data) => {
        setProfile(data)
        setAvatarUrl(data.avatarUrl)
      })
      .catch(() => toast.error("Error al cargar perfil"))
      .finally(() => setLoading(false))
  }, [])

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
      await update()
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

  const handleNameUpdated = async () => {
    await update()
    // Refrescar profile data
    const res = await fetch("/api/users/profile")
    const data = await res.json()
    setProfile(data)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Mi Perfil</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Gestiona tu informacion personal y seguridad
        </p>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general" className="gap-2">
            <User className="h-4 w-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="seguridad" className="gap-2">
            <Shield className="h-4 w-4" />
            Seguridad
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          {/* Avatar */}
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

          {/* Info personal */}
          {profile && (
            <PersonalInfo
              initialName={profile.nombre}
              email={profile.email}
              role={profile.rol}
              onNameUpdated={handleNameUpdated}
            />
          )}
        </TabsContent>

        <TabsContent value="seguridad" className="space-y-4 mt-4">
          {/* Cambio de contraseña */}
          {profile?.hasPassword ? (
            <ChangePassword />
          ) : (
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <Info className="h-5 w-5 text-muted-foreground shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Tu cuenta usa autenticacion con Google. La contraseña se gestiona desde tu cuenta de Google.
                </p>
              </CardContent>
            </Card>
          )}

          {/* 2FA */}
          {profile && (
            <SecuritySettings totpEnabled={profile.totpEnabled} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
