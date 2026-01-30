import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

export function LoadingSpinner({ size = "md", className }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  }

  return (
    <Loader2 className={cn("animate-spin text-primary", sizeClasses[size], className)} />
  )
}

interface LoadingOverlayProps {
  children?: React.ReactNode
  className?: string
}

export function LoadingOverlay({ children, className }: LoadingOverlayProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12", className)}>
      <LoadingSpinner size="lg" />
      {children && <p className="text-sm text-muted-foreground">{children}</p>}
    </div>
  )
}

interface InlineLoaderProps {
  className?: string
}

export function InlineLoader({ className }: InlineLoaderProps) {
  return <LoadingSpinner size="sm" className={className} />
}
