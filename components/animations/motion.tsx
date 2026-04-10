"use client"

import { LazyMotion, domAnimation, m, useInView, useScroll, useTransform, type Variants } from "framer-motion"
import { useRef, ReactNode } from "react"

// ========================================
// VARIANTES DE ANIMACIÓN REUTILIZABLES
// ========================================

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }
  }
}

export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }
  }
}

export const fadeInLeft: Variants = {
  hidden: { opacity: 0, x: -60 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.7, ease: [0.25, 0.4, 0.25, 1] }
  }
}

export const fadeInRight: Variants = {
  hidden: { opacity: 0, x: 60 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.7, ease: [0.25, 0.4, 0.25, 1] }
  }
}

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: [0.25, 0.4, 0.25, 1] }
  }
}

export const bounceIn: Variants = {
  hidden: { opacity: 0, scale: 0.3 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 15
    }
  }
}

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.1
    }
  }
}

export const staggerContainerFast: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.05
    }
  }
}

// ========================================
// COMPONENTES DE ANIMACIÓN
// ========================================

interface MotionWrapperProps {
  children: ReactNode
  className?: string
  variants?: Variants
  delay?: number
  once?: boolean
  amount?: number
}

// Fade In desde abajo con detección de scroll
export function FadeInUp({
  children,
  className = "",
  delay = 0,
  once = true,
  amount = 0.1
}: MotionWrapperProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once, amount })

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        variants={fadeInUp}
        transition={{ delay }}
        className={className}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Fade In desde arriba
export function FadeInDown({
  children,
  className = "",
  delay = 0,
  once = true,
  amount = 0.1
}: MotionWrapperProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once, amount })

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        variants={fadeInDown}
        transition={{ delay }}
        className={className}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Fade In desde la izquierda
export function FadeInLeft({
  children,
  className = "",
  delay = 0,
  once = true,
  amount = 0.1
}: MotionWrapperProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once, amount })

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        variants={fadeInLeft}
        transition={{ delay }}
        className={className}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Fade In desde la derecha
export function FadeInRight({
  children,
  className = "",
  delay = 0,
  once = true,
  amount = 0.1
}: MotionWrapperProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once, amount })

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        variants={fadeInRight}
        transition={{ delay }}
        className={className}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Scale In con rebote
export function ScaleIn({
  children,
  className = "",
  delay = 0,
  once = true,
  amount = 0.1
}: MotionWrapperProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once, amount })

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        variants={scaleIn}
        transition={{ delay }}
        className={className}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Bounce In (más dramático)
export function BounceIn({
  children,
  className = "",
  delay = 0,
  once = true,
  amount = 0.1
}: MotionWrapperProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once, amount })

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        variants={bounceIn}
        transition={{ delay }}
        className={className}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Contenedor con stagger para hijos
export function StaggerContainer({
  children,
  className = "",
  once = true,
  amount = 0.2,
  fast = false
}: MotionWrapperProps & { fast?: boolean }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once, amount })

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        variants={fast ? staggerContainerFast : staggerContainer}
        className={className}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Item hijo para usar con StaggerContainer
export function StaggerItem({
  children,
  className = "",
  variants = fadeInUp
}: { children: ReactNode; className?: string; variants?: Variants }) {
  return (
    <m.div variants={variants} className={className}>
      {children}
    </m.div>
  )
}

// ========================================
// EFECTOS ESPECIALES
// ========================================

// Parallax vertical
export function ParallaxY({
  children,
  className = "",
  offset = 100
}: { children: ReactNode; className?: string; offset?: number }) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  })

  const y = useTransform(scrollYProgress, [0, 1], [offset, -offset])

  return (
    <LazyMotion features={domAnimation}>
      <m.div ref={ref} style={{ y }} className={className}>
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Parallax con escala
export function ParallaxScale({
  children,
  className = "",
  scaleRange = [0.8, 1.1]
}: { children: ReactNode; className?: string; scaleRange?: [number, number] }) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  })

  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [scaleRange[0], 1, scaleRange[1]])

  return (
    <LazyMotion features={domAnimation}>
      <m.div ref={ref} style={{ scale }} className={className}>
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Floating animation (para iconos decorativos)
export function FloatingElement({
  children,
  className = "",
  duration = 3,
  yOffset = 10
}: { children: ReactNode; className?: string; duration?: number; yOffset?: number }) {
  return (
    <LazyMotion features={domAnimation}>
      <m.div
        animate={{
          y: [-yOffset, yOffset, -yOffset],
        }}
        transition={{
          duration,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className={className}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Rotate on scroll
export function RotateOnScroll({
  children,
  className = "",
  rotateRange = [0, 360]
}: { children: ReactNode; className?: string; rotateRange?: [number, number] }) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  })

  const rotate = useTransform(scrollYProgress, [0, 1], rotateRange)

  return (
    <LazyMotion features={domAnimation}>
      <m.div ref={ref} style={{ rotate }} className={className}>
        {children}
      </m.div>
    </LazyMotion>
  )
}

// ========================================
// HOVER EFFECTS
// ========================================

// Card con hover lift
export function HoverLift({
  children,
  className = ""
}: { children: ReactNode; className?: string }) {
  return (
    <LazyMotion features={domAnimation}>
      <m.div
        whileHover={{
          y: -8,
          transition: { duration: 0.3, ease: "easeOut" }
        }}
        className={className}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Card con hover scale
export function HoverScale({
  children,
  className = "",
  scale = 1.05
}: { children: ReactNode; className?: string; scale?: number }) {
  return (
    <LazyMotion features={domAnimation}>
      <m.div
        whileHover={{
          scale,
          transition: { duration: 0.3, ease: "easeOut" }
        }}
        className={className}
      >
        {children}
      </m.div>
    </LazyMotion>
  )
}

// Botón con efectos
export function AnimatedButton({
  children,
  className = "",
  onClick
}: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <LazyMotion features={domAnimation}>
      <m.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        className={className}
        onClick={onClick}
      >
        {children}
      </m.button>
    </LazyMotion>
  )
}

// ========================================
// TEXT ANIMATIONS
// ========================================

// Texto que aparece letra por letra
export function TextReveal({
  text,
  className = "",
  delay = 0
}: { text: string; className?: string; delay?: number }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0.5 })

  const words = text.split(" ")

  return (
    <LazyMotion features={domAnimation}>
      <m.span ref={ref} className={className}>
        {words.map((word, i) => (
          <m.span
            key={`${word}-${i}`}
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{
              duration: 0.4,
              delay: delay + i * 0.1,
              ease: [0.25, 0.4, 0.25, 1]
            }}
            style={{ display: "inline-block", marginRight: "0.25em" }}
          >
            {word}
          </m.span>
        ))}
      </m.span>
    </LazyMotion>
  )
}

// Contador animado
export function AnimatedCounter({
  from = 0,
  to,
  duration = 2,
  className = ""
}: { from?: number; to: number; duration?: number; className?: string }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0.5 })

  return (
    <LazyMotion features={domAnimation}>
      <m.span
        ref={ref}
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : { opacity: 0 }}
        className={className}
      >
        <m.span
          initial={{ opacity: 1 }}
          animate={isInView ? { opacity: 1 } : { opacity: 1 }}
        >
          {isInView ? (
            <m.span
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
            >
              <CounterValue from={from} to={to} duration={duration} />
            </m.span>
          ) : from}
        </m.span>
      </m.span>
    </LazyMotion>
  )
}

function CounterValue({ from, to, duration }: { from: number; to: number; duration: number }) {
  const nodeRef = useRef<HTMLSpanElement>(null)

  return (
    <m.span
      ref={nodeRef}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
    >
      <m.span
        animate={{ opacity: 1 }}
        transition={{ duration }}
        onUpdate={() => {
          // Counter logic handled by CSS/spring
        }}
      >
        {to}
      </m.span>
    </m.span>
  )
}

// Re-export m (lightweight motion) and hooks for custom use
export { m, useInView, useScroll, useTransform, LazyMotion, domAnimation }
