import { cn } from "@/lib/utils"

type TotalTone = "default" | "success" | "danger" | "info"

interface TotalRowProps {
  label: React.ReactNode
  amount: React.ReactNode
  /** Emphasized total: larger, semibold, foreground label. */
  emphasis?: boolean
  /** Tints the amount with a semantic token. */
  tone?: TotalTone
  className?: string
}

const AMOUNT_TONE: Record<TotalTone, string> = {
  default: "",
  success: "text-success",
  danger: "text-destructive",
  info: "text-info",
}

/**
 * Two-column label/amount row used in the cart and checkout totals.
 * Replaces the repeated `flex justify-between` blocks with one styled source.
 */
export function TotalRow({
  label,
  amount,
  emphasis = false,
  tone = "default",
  className,
}: TotalRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        emphasis ? "text-base font-semibold sm:text-lg" : "text-sm",
        className
      )}
    >
      <span className={emphasis ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
      <span className={cn("tabular-nums", AMOUNT_TONE[tone])}>{amount}</span>
    </div>
  )
}
