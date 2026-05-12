"use client"

import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Share2, Check } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  )
}

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
          <Image
            src={bannerUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        </div>
        <div className="container mx-auto max-w-5xl px-4 -mt-20 sm:-mt-24 relative pb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            {logoUrl && (
              <div className="relative h-20 w-20 sm:h-24 sm:w-24 rounded-2xl overflow-hidden bg-white border-4 border-background shadow-lg shrink-0">
                <Image src={logoUrl} alt={titulo} fill sizes="96px" className="object-cover" priority />
              </div>
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
                    <WhatsAppIcon className="h-4 w-4" />
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
            <div className="relative h-16 w-16 rounded-xl overflow-hidden bg-white border shadow-sm shrink-0">
              <Image src={logoUrl} alt={titulo} fill sizes="64px" className="object-cover" priority />
            </div>
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
                  <WhatsAppIcon className="h-4 w-4" />
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
