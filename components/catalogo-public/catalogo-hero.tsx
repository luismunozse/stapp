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
    <div className="container mx-auto max-w-5xl px-4 pb-2">
      <ul className="flex flex-wrap items-center gap-2">
        {items.map((b, i) => {
          const Icon = TRUST_ICONS[b.icon] ?? CheckCircle2
          return (
            <li
              key={`${b.icon}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-cat-border bg-cat-surface px-3.5 py-1.5 text-xs font-medium text-cat-ink"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: brandColor }} />
              <span>{b.label}</span>
            </li>
          )
        })}
      </ul>
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
        <div className={`${aspectMobile} ${aspectDesktop} relative overflow-hidden bg-cat-chip`}>
          <Image src={bannerUrl} alt="" fill priority sizes="100vw" className="object-cover" />
          {/* Warm ink gradient (not neutral black) per design system */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#221c14]/70 via-[#221c14]/10 to-transparent" />
          <div className="absolute bottom-3 right-3 flex gap-2 sm:bottom-4 sm:right-4">
            {whatsappLink && (
              <Button
                asChild
                className="h-11 gap-2 rounded-full bg-whatsapp px-4 font-display font-bold text-white shadow-lg hover:bg-whatsapp/90"
                aria-label="Contactar por WhatsApp"
              >
                <a href={whatsappLink} target="_blank" rel="noreferrer">
                  <WhatsAppIcon className="h-5 w-5" />
                  <span>WhatsApp</span>
                </a>
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleShare}
              className="h-11 gap-1.5 rounded-full bg-cat-surface/90 font-display font-bold text-cat-ink backdrop-blur hover:bg-cat-surface"
            >
              {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              <span className="hidden sm:inline">Compartir</span>
            </Button>
          </div>
        </div>
        <div className="container relative mx-auto max-w-5xl px-4 pb-4">
          <div className="flex items-end gap-4">
            {logoUrl && (
              <div className="relative -mt-9 h-[76px] w-[76px] shrink-0 overflow-hidden rounded-squircle border-[3px] border-cat-surface bg-white shadow-cat-lg sm:-mt-11 sm:h-24 sm:w-24">
                <Image src={logoUrl} alt={titulo} fill sizes="96px" className="object-contain p-1" priority />
              </div>
            )}
          </div>
          <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-cat-ink sm:text-4xl">{titulo}</h1>
          {descripcion && <p className="mt-1 text-sm text-cat-muted sm:text-base line-clamp-2">{descripcion}</p>}
        </div>
      </header>
      <TrustStrip items={trustBadges ?? []} brandColor={brandColor} />
      </>
    )
  }

  return (
    <>
    <header className="relative overflow-hidden">
      {/* Radial brand mesh over ivory: every store looks distinct with zero config */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(75% 65% at 0% -20%, var(--brand-tint-strong, #0f172a14), transparent 60%)," +
            "radial-gradient(65% 60% at 100% 0%, var(--brand-tint, #0f172a0a), transparent 55%)",
        }}
      />
      <div className={`container relative mx-auto max-w-5xl px-4 ${descripcion ? "py-10 sm:py-14" : "py-8 sm:py-10"}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-squircle bg-cat-surface shadow-cat-lg sm:h-20 sm:w-20">
            {logoUrl ? (
              <Image src={logoUrl} alt={titulo} fill sizes="80px" className="object-contain p-1.5" priority />
            ) : (
              <CatalogoImagePlaceholder name={titulo} className="h-full w-full" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-extrabold leading-[1.05] tracking-tight text-cat-ink sm:text-5xl">{titulo}</h1>
            {descripcion && (
              <p className="mt-2 max-w-2xl text-base leading-relaxed text-cat-muted sm:text-lg line-clamp-3">{descripcion}</p>
            )}
          </div>
          <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
            {whatsappLink && (
              <Button
                asChild
                className="h-11 flex-1 gap-2 rounded-full bg-whatsapp px-4 font-display font-bold text-white shadow-lg hover:bg-whatsapp/90 sm:flex-none"
                aria-label="Contactar por WhatsApp"
              >
                <a href={whatsappLink} target="_blank" rel="noreferrer">
                  <WhatsAppIcon className="h-5 w-5" />
                  <span>Pedir por WhatsApp</span>
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleShare}
              className="h-11 flex-1 gap-1.5 rounded-full border-[1.5px] border-cat-border bg-cat-surface font-display font-bold text-cat-ink sm:flex-none"
            >
              {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              <span className="hidden sm:inline">Compartir</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
    <TrustStrip items={trustBadges ?? []} brandColor={brandColor} />
    </>
  )
}
