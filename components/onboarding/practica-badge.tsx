import { GraduationCap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface PracticaBadgeProps {
  /** Adds "· se borra cuando cargues tu primera orden real" next to the pill. */
  conAviso?: boolean
  className?: string
}

export function PracticaBadge({ conAviso = false, className }: PracticaBadgeProps) {
  return (
    <div className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5", className)}>
      <Badge variant="infoSoft" showIcon icon={GraduationCap}>
        Práctica
      </Badge>
      {conAviso && (
        <span className="text-xs text-muted-foreground">
          · se borra cuando cargues tu primera orden real
        </span>
      )}
    </div>
  )
}
