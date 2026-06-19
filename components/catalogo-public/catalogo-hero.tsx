"use client"

import Image from "next/image"
import { Button } from "@/components/ui/button"
import {
  Share2, Check, Truck, Shield, Undo2, CreditCard, Clock,
  Star, CheckCircle2, Phone, MapPin, type LucideIcon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { CatalogoImagePlaceholder } from "./catalogo-image-placeholder"

interface TrustBadgeData {
  icon: string
  label: string
}

interface Props {
  bannerUrl: string | null
  logoUrl: string | null
  titulo: string
  descripcion: string | null
  whatsapp: string | null
  brandColor: string
  shareUrl: string
  trustBadges?: TrustBadgeData[]
}

const TRUST_ICONS: Record<string, LucideIcon> = {
  truck: Truck,
  shield: Shield,
  undo: Undo2,
  card: CreditCard,
  clock: Clock,
  star: Star,
  check: CheckCircle2,
  phone: Phone,
  map: MapPin,
}

function TrustStrip({ items, brandColor }: { items: TrustBadgeData[]; brandColor: string }) {
  if (!items?.length) return null
  return (
    <div className="border-y bg-muted/30">
      <div className="container mx-auto max-w-5xl px-4 py-2.5">
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs sm:text-sm text-muted-foreground">
          {items.map((b, i) => {
            const Icon = TRUST_ICONS[b.icon] ?? CheckCircle2
            return (
              <li key={`${b.icon}-${i}`} className="inline-flex items-center gap-1.5">
                <Icon className="h-4 w-4 shrink-0" style={{ color: brandColor }} />
                <span className="font-medium text-foreground">{b.label}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export function CatalogoHero({ bannerUrl, logoUrl, titulo, descripcion, whatsapp, brandColor, shareUrl, trustBadges }: Props) {
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
    // Aspect ratio adaptive: cuando no hay descripción, banner más corto para
    // que el contenido bajo el banner suba above-the-fold antes.
    const aspectMobile = descripcion ? "aspect-[3/1]" : "aspect-[16/5]"
    const aspectDesktop = descripcion ? "sm:aspect-[4/1]" : "sm:aspect-[5/1]"
    return (
      <>
      <header className="relative">
        <div className={`${aspectMobile} ${aspectDesktop} relative overflow-hidden bg-muted`}>
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
                <Image src={logoUrl} alt={titulo} fill sizes="96px" className="object-contain p-1" priority />
              </div>
            )}
            <div className="flex-1 min-w-0 text-white sm:pb-2">
              <h1 className="text-2xl sm:text-4xl font-bold drop-shadow-lg">{titulo}</h1>
              {descripcion && <p className="mt-1 sm:text-lg drop-shadow opacity-90 line-clamp-2">{descripcion}</p>}
            </div>
            <div className="flex gap-2 sm:pb-2">
              <Button
                variant="secondary"
                onClick={handleShare}
                className="gap-1.5 h-11 bg-white/90 backdrop-blur text-foreground hover:bg-white"
              >
                {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                <span className="hidden sm:inline">Compartir</span>
              </Button>
              {whatsappLink && (
                <Button
                  asChild
                  className="gap-2 h-11 px-4 shadow-md hover:shadow-lg transition-shadow"
                  style={{ backgroundColor: "var(--brand)", color: "var(--brand-foreground)" }}
                  aria-label="Contactar por WhatsApp"
                >
                  <a href={whatsappLink} target="_blank" rel="noreferrer">
                    <WhatsAppIcon className="h-5 w-5" />
                    <span>WhatsApp</span>
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>
      <TrustStrip items={trustBadges ?? []} brandColor={brandColor} />
      </>
    )
  }

  return (
    <>
    <header className="relative border-b overflow-hidden">
      {/* Mesh de marca: gradientes radiales en el brand color (vía CSS vars) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(75% 65% at 0% -20%, var(--brand-tint-strong, #0f172a14), transparent 60%)," +
            "radial-gradient(65% 60% at 100% 0%, var(--brand-tint, #0f172a0a), transparent 55%)",
        }}
      />
      <div className={`container mx-auto max-w-5xl px-4 relative ${descripcion ? "py-12 sm:py-16" : "py-10 sm:py-12"}`}>
        <div className="flex flex-col sm:flex-row gap-5 sm:gap-6 items-start sm:items-center">
          <div className="relative h-16 w-16 sm:h-20 sm:w-20 rounded-2xl overflow-hidden border bg-background shadow-sm shrink-0">
            {logoUrl ? (
              <Image src={logoUrl} alt={titulo} fill sizes="80px" className="object-contain p-1.5" priority />
            ) : (
              <CatalogoImagePlaceholder name={titulo} className="h-full w-full" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">{titulo}</h1>
            {descripcion && (
              <p className="text-muted-foreground mt-2 text-base sm:text-lg leading-relaxed line-clamp-3 max-w-2xl">{descripcion}</p>
            )}
          </div>
          <div className="flex gap-2 w-full sm:w-auto sm:shrink-0">
            <Button
              variant="outline"
              onClick={handleShare}
              className="gap-1.5 flex-1 sm:flex-none h-11 bg-background/80 backdrop-blur"
            >
              {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              <span className="hidden sm:inline">Compartir</span>
            </Button>
            {whatsappLink && (
              <Button
                asChild
                className="gap-2 flex-1 sm:flex-none h-11 px-4 shadow-md hover:shadow-lg transition-shadow"
                style={{ backgroundColor: "var(--brand)", color: "var(--brand-foreground)" }}
                aria-label="Contactar por WhatsApp"
              >
                <a href={whatsappLink} target="_blank" rel="noreferrer">
                  <WhatsAppIcon className="h-5 w-5" />
                  <span>WhatsApp</span>
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
    <TrustStrip items={trustBadges ?? []} brandColor={brandColor} />
    </>
  )
}
