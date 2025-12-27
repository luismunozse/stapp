"use client"

import * as React from "react"
import { Moon, Sun, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Theme = "light" | "dark" | "system"

interface ThemeToggleProps {
  className?: string
  variant?: "default" | "icon" | "dropdown"
}

export function ThemeToggle({ className, variant = "icon" }: ThemeToggleProps) {
  const [theme, setTheme] = React.useState<Theme>("system")
  const [mounted, setMounted] = React.useState(false)

  // Only run on client side
  React.useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem("theme") as Theme | null
    if (savedTheme) {
      setTheme(savedTheme)
    }
  }, [])

  React.useEffect(() => {
    if (!mounted) return

    const root = document.documentElement

    // Add transitioning class for smooth theme change
    root.classList.add("transitioning")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      root.classList.toggle("dark", systemTheme === "dark")
      localStorage.removeItem("theme")
    } else {
      root.classList.toggle("dark", theme === "dark")
      localStorage.setItem("theme", theme)
    }

    // Remove transitioning class after animation
    const timeout = setTimeout(() => {
      root.classList.remove("transitioning")
    }, 300)

    return () => clearTimeout(timeout)
  }, [theme, mounted])

  // Listen for system theme changes
  React.useEffect(() => {
    if (!mounted || theme !== "system") return

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle("dark", e.matches)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [theme, mounted])

  const cycleTheme = () => {
    const themes: Theme[] = ["light", "dark", "system"]
    const currentIndex = themes.indexOf(theme)
    const nextIndex = (currentIndex + 1) % themes.length
    setTheme(themes[nextIndex])
  }

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className={className} disabled>
        <Sun className="h-5 w-5" />
      </Button>
    )
  }

  if (variant === "icon") {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={cycleTheme}
        className={cn("relative", className)}
        title={`Tema actual: ${theme === "system" ? "Sistema" : theme === "dark" ? "Oscuro" : "Claro"}`}
      >
        <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className="sr-only">Cambiar tema</span>
      </Button>
    )
  }

  if (variant === "dropdown") {
    return (
      <div className={cn("w-full", className)}>
        <span className="text-xs font-medium text-muted-foreground block mb-2">Tema</span>
        <div className="inline-flex rounded-lg border border-input p-1 bg-muted/50 w-full">
          <button
            type="button"
            onClick={() => setTheme("light")}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              theme === "light"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <Sun className="h-3.5 w-3.5" />
            Claro
          </button>
          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              theme === "dark"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <Moon className="h-3.5 w-3.5" />
            Oscuro
          </button>
          <button
            type="button"
            onClick={() => setTheme("system")}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              theme === "system"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <Monitor className="h-3.5 w-3.5" />
            Auto
          </button>
        </div>
      </div>
    )
  }

  // Default variant
  return (
    <Button
      variant="outline"
      onClick={cycleTheme}
      className={cn("gap-2", className)}
    >
      {theme === "light" && <Sun className="h-4 w-4" />}
      {theme === "dark" && <Moon className="h-4 w-4" />}
      {theme === "system" && <Monitor className="h-4 w-4" />}
      <span>
        {theme === "light" && "Claro"}
        {theme === "dark" && "Oscuro"}
        {theme === "system" && "Sistema"}
      </span>
    </Button>
  )
}

// Hook for programmatic theme control
export function useTheme() {
  const [theme, setTheme] = React.useState<Theme>("system")
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem("theme") as Theme | null
    if (savedTheme) {
      setTheme(savedTheme)
    }
  }, [])

  const setThemeValue = React.useCallback((newTheme: Theme) => {
    setTheme(newTheme)
    const root = document.documentElement
    root.classList.add("transitioning")

    if (newTheme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      root.classList.toggle("dark", systemTheme === "dark")
      localStorage.removeItem("theme")
    } else {
      root.classList.toggle("dark", newTheme === "dark")
      localStorage.setItem("theme", newTheme)
    }

    setTimeout(() => {
      root.classList.remove("transitioning")
    }, 300)
  }, [])

  const resolvedTheme = React.useMemo(() => {
    if (!mounted) return "light"
    if (theme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }
    return theme
  }, [theme, mounted])

  return {
    theme,
    setTheme: setThemeValue,
    resolvedTheme,
    mounted,
  }
}
