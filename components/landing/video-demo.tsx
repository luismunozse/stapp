"use client"

import { useState } from "react"
import { Play } from "lucide-react"
import { LazyMotion, domAnimation, m } from "framer-motion"
import { cn } from "@/lib/utils"

// Reemplazar con la URL real del video cuando esté disponible
const YOUTUBE_VIDEO_ID = "" // ej: "dQw4w9WgXcQ"

export function VideoDemo() {
  const [playing, setPlaying] = useState(false)

  return (
    <LazyMotion features={domAnimation}>
      <section className="py-12 sm:py-16 overflow-hidden">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <m.div
            className="text-center max-w-3xl mx-auto mb-8"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Mirá cómo funciona en 60 segundos
            </h2>
            <p className="text-lg text-muted-foreground">
              Desde que entra un equipo hasta que se lo entregás al cliente, todo queda registrado.
            </p>
          </m.div>

          <m.div
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <div className="relative aspect-video rounded-2xl overflow-hidden border shadow-xl bg-muted/50">
              {playing && YOUTUBE_VIDEO_ID ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_VIDEO_ID}?autoplay=1&rel=0`}
                  title="Demo de STApp - Software de gestión para servicio técnico"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full"
                />
              ) : (
                <button
                  onClick={() => YOUTUBE_VIDEO_ID && setPlaying(true)}
                  className={cn(
                    "absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-4 group",
                    "bg-gradient-to-br from-primary/10 via-muted/50 to-primary/5"
                  )}
                  aria-label="Reproducir video demo"
                >
                  {/* Play button */}
                  <m.div
                    className="w-20 h-20 rounded-full bg-primary flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    animate={{
                      boxShadow: [
                        "0 0 0 0 rgba(59, 130, 246, 0.4)",
                        "0 0 0 20px rgba(59, 130, 246, 0)",
                      ],
                    }}
                    transition={{
                      boxShadow: { duration: 2, repeat: Infinity },
                    }}
                  >
                    <Play className="w-8 h-8 text-primary-foreground ml-1" />
                  </m.div>

                  <span className="text-sm text-muted-foreground font-medium">
                    {YOUTUBE_VIDEO_ID ? "Ver demo" : "Video próximamente"}
                  </span>
                </button>
              )}
            </div>
          </m.div>
        </div>
      </section>
    </LazyMotion>
  )
}
