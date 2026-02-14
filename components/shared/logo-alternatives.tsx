"use client"

import { cn } from "@/lib/utils"

interface LogoProps {
  className?: string
  size?: "sm" | "md" | "lg" | "xl"
  variant?: "full" | "icon"
}

const sizeConfig = {
  sm: { icon: 24, text: "text-lg", gap: "gap-1.5" },
  md: { icon: 32, text: "text-xl", gap: "gap-2" },
  lg: { icon: 48, text: "text-2xl", gap: "gap-2.5" },
  xl: { icon: 64, text: "text-3xl", gap: "gap-3" },
}

// ============================================
// ALTERNATIVA 1: Wrench + Circuit
// Concepto: Herramienta de reparación con líneas de circuito
// ============================================
export function LogoWrenchCircuit({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Wrench shape */}
        <path
          d="M38 10c-3.3-3.3-8.2-3.8-12-1.6l-9.8 9.8c-2.2-3.8-1.7-8.7 1.6-12 3.3-3.3 8.5-3.7 12.2-1.2l-4.2 4.2c-.8.8-.8 2 0 2.8l2.2 2.2c.8.8 2 .8 2.8 0l4.2-4.2c2.5 3.7 2.1 8.9-1.2 12.2-3.3 3.3-8.2 3.8-12 1.6l-9.8 9.8c-1.6 1.6-4.1 1.6-5.7 0l-2.2-2.2c-1.6-1.6-1.6-4.1 0-5.7l9.8-9.8c-2.2-3.8-1.7-8.7 1.6-12z"
          className="fill-primary"
        />
        {/* Circuit lines */}
        <path
          d="M32 28h8M40 28v8M40 36h-4M36 36v4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-primary/60"
        />
        <circle cx="40" cy="28" r="2" className="fill-primary/60" />
        <circle cx="36" cy="40" r="2" className="fill-primary/60" />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 2: Monograma ST Geométrico
// Concepto: Iniciales ST en forma moderna/tech
// ============================================
export function LogoMonogramST({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Background rounded square */}
        <rect
          x="4"
          y="4"
          width="40"
          height="40"
          rx="10"
          className="fill-primary"
        />
        {/* S letter */}
        <path
          d="M14 18c0-2.2 1.8-4 4-4h4c2.2 0 4 1.8 4 4v2c0 1.1-.9 2-2 2h-6c-1.1 0-2 .9-2 2v2c0 2.2 1.8 4 4 4h4c2.2 0 4-1.8 4-4"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* T letter */}
        <path
          d="M28 14h10M33 14v20"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 3: Device + Checkmark
// Concepto: Dispositivo con check de reparación completada
// ============================================
export function LogoDeviceCheck({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Phone outline */}
        <rect
          x="12"
          y="4"
          width="24"
          height="40"
          rx="4"
          className="stroke-primary"
          strokeWidth="2.5"
          fill="none"
        />
        {/* Screen */}
        <rect
          x="15"
          y="10"
          width="18"
          height="24"
          rx="2"
          className="fill-primary/10"
        />
        {/* Check circle */}
        <circle cx="36" cy="36" r="10" className="fill-success-500" />
        <path
          d="M31 36l3 3 6-6"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Home button */}
        <circle cx="24" cy="40" r="2" className="fill-primary/40" />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 4: Tools Abstract
// Concepto: Destornillador y llave formando un shape abstracto
// ============================================
export function LogoToolsAbstract({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Gradient definition */}
        <defs>
          <linearGradient id="toolGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" className="[stop-color:hsl(var(--primary))]" />
            <stop offset="100%" className="[stop-color:hsl(var(--primary)/0.6)]" />
          </linearGradient>
        </defs>
        {/* Screwdriver */}
        <path
          d="M8 40l18-18 4 4-18 18-4-4z"
          fill="url(#toolGradient)"
        />
        <path
          d="M26 22l6-6c2-2 5-2 7 0s2 5 0 7l-6 6"
          className="fill-primary"
        />
        {/* Wrench */}
        <path
          d="M40 8l-8 8 4 4 8-8c0 0 2 4-2 8l-6 6-4-4 6-6c-4 4-8 2-8 2l8-8 2-2z"
          className="fill-primary/70"
        />
        {/* Sparkle accents */}
        <circle cx="14" cy="14" r="2" className="fill-primary/40" />
        <circle cx="34" cy="34" r="1.5" className="fill-primary/30" />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 5: Hexagon Tech
// Concepto: Hexágono (tech/moderno) con ST integrado
// ============================================
export function LogoHexagonTech({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Hexagon background */}
        <path
          d="M24 4L42 14v20L24 44 6 34V14L24 4z"
          className="fill-primary"
        />
        {/* Inner hexagon outline */}
        <path
          d="M24 10L36 17v14L24 38 12 31V17L24 10z"
          className="stroke-white/30"
          strokeWidth="1"
          fill="none"
        />
        {/* ST text */}
        <text
          x="24"
          y="28"
          textAnchor="middle"
          className="fill-white font-bold"
          fontSize="14"
          fontFamily="system-ui"
        >
          ST
        </text>
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 6: Bolt/Lightning
// Concepto: Rayo (rapidez, energía) + tech
// ============================================
export function LogoBolt({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Circle background */}
        <circle cx="24" cy="24" r="20" className="fill-primary/10" />
        <circle cx="24" cy="24" r="20" className="stroke-primary" strokeWidth="2" fill="none" />
        {/* Lightning bolt */}
        <path
          d="M26 8L14 26h8l-2 14 12-18h-8l2-14z"
          className="fill-primary"
        />
        {/* Sparkles */}
        <circle cx="36" cy="12" r="2" className="fill-warning-500" />
        <circle cx="38" cy="20" r="1" className="fill-warning-500" />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 7: Gear/Engranaje Moderno
// Concepto: Engranaje minimalista
// ============================================
export function LogoGear({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Outer gear */}
        <path
          d="M24 6l2 4h4l3-3 3 3-3 3v4l4 2v4l-4 2v4l3 3-3 3-3-3h-4l-2 4h-4l-2-4h-4l-3 3-3-3 3-3v-4l-4-2v-4l4-2v-4l-3-3 3-3 3 3h4l2-4h4z"
          className="fill-primary"
        />
        {/* Inner circle */}
        <circle cx="24" cy="24" r="8" className="fill-background" />
        {/* Center dot */}
        <circle cx="24" cy="24" r="4" className="fill-primary/60" />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 8: Shield/Escudo Pro
// Concepto: Confianza, profesionalismo, garantía
// ============================================
export function LogoShield({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Shield shape */}
        <path
          d="M24 4L6 10v14c0 10 8 18 18 20 10-2 18-10 18-20V10L24 4z"
          className="fill-primary"
        />
        {/* Inner shield */}
        <path
          d="M24 8L10 13v11c0 8 6 14 14 16 8-2 14-8 14-16V13L24 8z"
          className="fill-primary/80"
        />
        {/* Checkmark */}
        <path
          d="M18 24l4 4 8-8"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 9: Device Futurista
// Concepto: Smartphone con líneas de circuito tech
// ============================================
export function LogoDeviceFuturista({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        <defs>
          <linearGradient id="deviceGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" className="[stop-color:hsl(var(--primary))]" />
            <stop offset="100%" className="[stop-color:hsl(var(--primary)/0.7)]" />
          </linearGradient>
        </defs>
        {/* Phone body */}
        <rect
          x="10"
          y="4"
          width="28"
          height="40"
          rx="6"
          fill="url(#deviceGradient)"
        />
        {/* Screen */}
        <rect
          x="14"
          y="10"
          width="20"
          height="28"
          rx="2"
          className="fill-background"
        />
        {/* Circuit lines on screen */}
        <path
          d="M18 18h4v4h6v-4h2M18 26h10M22 26v6"
          className="stroke-primary"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Circuit nodes */}
        <circle cx="18" cy="18" r="1.5" className="fill-primary" />
        <circle cx="28" cy="26" r="1.5" className="fill-primary" />
        <circle cx="22" cy="32" r="1.5" className="fill-primary" />
        {/* Notch */}
        <rect x="20" y="6" width="8" height="2" rx="1" className="fill-background/50" />
        {/* Home bar */}
        <rect x="18" y="40" width="12" height="2" rx="1" className="fill-white/30" />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 10: Multi-Device Stack
// Concepto: Múltiples dispositivos apilados (laptop + phone)
// ============================================
export function LogoMultiDevice({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        <defs>
          <linearGradient id="multiGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" className="[stop-color:hsl(var(--primary))]" />
            <stop offset="100%" className="[stop-color:hsl(var(--primary)/0.6)]" />
          </linearGradient>
        </defs>
        {/* Laptop screen */}
        <rect
          x="4"
          y="8"
          width="32"
          height="22"
          rx="3"
          fill="url(#multiGradient)"
        />
        {/* Laptop screen inner */}
        <rect
          x="7"
          y="11"
          width="26"
          height="16"
          rx="1"
          className="fill-background"
        />
        {/* Laptop base */}
        <path
          d="M2 30h36l-2 4H4l-2-4z"
          className="fill-primary/80"
        />
        {/* Phone overlay */}
        <rect
          x="32"
          y="18"
          width="14"
          height="26"
          rx="3"
          className="fill-primary"
        />
        <rect
          x="34"
          y="22"
          width="10"
          height="18"
          rx="1"
          className="fill-background"
        />
        {/* Signal waves */}
        <path
          d="M39 28c2 0 3 1 3 3M39 25c4 0 6 2 6 6"
          className="stroke-primary"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="39" cy="31" r="1.5" className="fill-primary" />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 11: Holographic Device
// Concepto: Dispositivo con efecto holográfico/3D
// ============================================
export function LogoHolographic({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        <defs>
          <linearGradient id="holoGradient1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" className="[stop-color:hsl(var(--primary))]" />
            <stop offset="50%" className="[stop-color:hsl(var(--primary)/0.8)]" />
            <stop offset="100%" className="[stop-color:hsl(var(--primary)/0.5)]" />
          </linearGradient>
        </defs>
        {/* Back layer (3D effect) */}
        <rect
          x="18"
          y="2"
          width="20"
          height="32"
          rx="4"
          className="fill-primary/20"
        />
        {/* Middle layer */}
        <rect
          x="14"
          y="6"
          width="20"
          height="32"
          rx="4"
          className="fill-primary/40"
        />
        {/* Front phone */}
        <rect
          x="10"
          y="10"
          width="20"
          height="32"
          rx="4"
          fill="url(#holoGradient1)"
        />
        {/* Screen */}
        <rect
          x="13"
          y="15"
          width="14"
          height="22"
          rx="1"
          className="fill-background"
        />
        {/* Holographic lines */}
        <path
          d="M16 22h8M16 26h6M16 30h8"
          className="stroke-primary/60"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Glow dots */}
        <circle cx="36" cy="8" r="2" className="fill-primary/60" />
        <circle cx="40" cy="16" r="1.5" className="fill-primary/40" />
        <circle cx="38" cy="24" r="1" className="fill-primary/30" />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// ALTERNATIVA 12: Neon Device
// Concepto: Dispositivo con bordes neón brillantes
// ============================================
export function LogoNeonDevice({ className, size = "md", variant = "full" }: LogoProps) {
  const { icon, text, gap } = sizeConfig[size]

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        <defs>
          <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Glow background */}
        <rect
          x="12"
          y="4"
          width="24"
          height="40"
          rx="5"
          className="fill-primary/10"
        />
        {/* Phone outline with glow */}
        <rect
          x="12"
          y="4"
          width="24"
          height="40"
          rx="5"
          className="stroke-primary"
          strokeWidth="2"
          fill="none"
          filter="url(#neonGlow)"
        />
        {/* Screen area */}
        <rect
          x="15"
          y="10"
          width="18"
          height="28"
          rx="2"
          className="fill-background"
        />
        {/* ST text in screen */}
        <text
          x="24"
          y="28"
          textAnchor="middle"
          className="fill-primary font-bold"
          fontSize="12"
          fontFamily="system-ui"
        >
          ST
        </text>
        {/* Pulse rings */}
        <circle cx="24" cy="24" r="18" className="stroke-primary/30" strokeWidth="1" fill="none" />
        <circle cx="24" cy="24" r="22" className="stroke-primary/15" strokeWidth="1" fill="none" />
        {/* Corner accents */}
        <circle cx="12" cy="4" r="2" className="fill-primary" />
        <circle cx="36" cy="44" r="2" className="fill-primary" />
      </svg>
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}

// ============================================
// Demo component to show all alternatives
// ============================================
export function LogoShowcase() {
  const logos = [
    { name: "Wrench + Circuit", component: LogoWrenchCircuit, desc: "Herramienta con líneas de circuito" },
    { name: "Monograma ST", component: LogoMonogramST, desc: "Iniciales en cuadrado redondeado" },
    { name: "Device + Check", component: LogoDeviceCheck, desc: "Teléfono con check de completado" },
    { name: "Tools Abstract", component: LogoToolsAbstract, desc: "Herramientas en forma abstracta" },
    { name: "Hexagon Tech", component: LogoHexagonTech, desc: "Hexágono moderno con ST" },
    { name: "Bolt/Lightning", component: LogoBolt, desc: "Rayo en círculo, velocidad" },
    { name: "Gear/Engranaje", component: LogoGear, desc: "Engranaje minimalista" },
    { name: "Shield Pro", component: LogoShield, desc: "Escudo de confianza y garantía" },
    { name: "Device Futurista", component: LogoDeviceFuturista, desc: "Smartphone con circuitos tech" },
    { name: "Multi-Device", component: LogoMultiDevice, desc: "Laptop + phone con señal" },
    { name: "Holographic", component: LogoHolographic, desc: "Dispositivo con efecto 3D" },
    { name: "Neon Device", component: LogoNeonDevice, desc: "Teléfono con bordes neón" },
  ]

  return (
    <div className="p-8 space-y-8">
      <h2 className="text-2xl font-bold mb-6">Alternativas de Logo para STApp</h2>

      <div className="grid gap-8">
        {logos.map(({ name, component: Logo, desc }) => (
          <div key={name} className="border rounded-lg p-6 space-y-4">
            <div>
              <h3 className="font-semibold text-lg">{name}</h3>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>

            <div className="flex flex-wrap items-center gap-8">
              {/* Icon only */}
              <div className="text-center">
                <Logo size="lg" variant="icon" />
                <span className="text-xs text-muted-foreground block mt-2">Solo icono</span>
              </div>

              {/* Full versions */}
              <div className="space-y-3">
                <div>
                  <Logo size="sm" variant="full" />
                </div>
                <div>
                  <Logo size="md" variant="full" />
                </div>
                <div>
                  <Logo size="lg" variant="full" />
                </div>
              </div>

              {/* Dark preview */}
              <div className="bg-gray-900 p-4 rounded-lg">
                <Logo size="md" variant="full" className="[&_span]:text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
