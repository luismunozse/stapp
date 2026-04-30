"use client"

import { Button } from "@/components/ui/button"
import { MessageCircle, Share2, Check } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

interface Props {
  bannerUrl: string | null
  logoUrl: string | null
  titulo: string
  descripcion: string | null
  whatsapp: string | null
  brandColor: string
  shareUrl: string
}

export function CatalogoHero({ bannerUrl, logoUrl, titulo, descripcion, whatsapp, brandColor, shareUrl }: Props) {
  const [shared, setShared] = useState(false)

  const whatsappLink = whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, "")}` : null

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: titulo, url: shareUrl })
      } catch {
        /* user cancelled */
      }
      return
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShared(true)
      toast.success("Link copiado")
      setTimeout(() => setShared(false), 2000)
    } catch {
      toast.error("No se pudo copiar")
    }
  }

  if (bannerUrl) {
    return (
      <header className="relative">
        <div className="aspect-[3/1] sm:aspect-[4/1] relative overflow-hidden bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        </div>
        <div className="container mx-auto max-w-5xl px-4 -mt-20 sm:-mt-24 relative pb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={titulo}
                className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl object-cover bg-white border-4 border-background shadow-lg"
              />
            )}
            <div className="flex-1 min-w-0 text-white sm:pb-2">
              <h1 className="text-2xl sm:text-4xl font-bold drop-shadow-lg">{titulo}</h1>
              {descripcion && <p className="mt-1 sm:text-lg drop-shadow opacity-90 line-clamp-2">{descripcion}</p>}
            </div>
            <div className="flex gap-2 sm:pb-2">
              <Button variant="secondary" size="sm" onClick={handleShare} className="gap-1.5">
                {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                <span className="hidden sm:inline">Compartir</span>
              </Button>
              {whatsappLink && (
                <Button asChild size="sm" className="gap-1.5" style={{ backgroundColor: brandColor }}>
                  <a href={whatsappLink} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-4 w-4" />
                    Contactar
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="border-b" style={{ background: `linear-gradient(180deg, ${brandColor}15 0%, transparent 100%)` }}>
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={titulo}
              className="h-16 w-16 rounded-xl object-cover bg-white border shadow-sm"
            />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{titulo}</h1>
            {descripcion && <p className="text-muted-foreground mt-1">{descripcion}</p>}
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={handleShare} className="gap-1.5 flex-1 sm:flex-none">
              {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              <span className="hidden sm:inline">Compartir</span>
            </Button>
            {whatsappLink && (
              <Button asChild className="gap-2 flex-1 sm:flex-none" style={{ backgroundColor: brandColor }}>
                <a href={whatsappLink} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" />
                  Contactar
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
