"use client"

import { useSidebar } from "@/components/layout/sidebar-context"

export function SidebarMain({ children, className }: { children: React.ReactNode; className?: string }) {
  const { collapsed } = useSidebar()

  return (
    <main
      id="main-content"
      className={`pb-[calc(4rem+env(safe-area-inset-bottom,0px))] lg:pb-0 transition-[padding-left] duration-300 ease-in-out ${className || ""}`}
      style={{
        // Solo aplica en desktop via media query CSS
      }}
    >
      <style>{`
        @media (min-width: 1024px) {
          #main-content {
            padding-left: ${collapsed ? "3.5rem" : "16rem"} !important;
          }
        }
      `}</style>
      <div className="p-4 lg:p-8">{children}</div>
    </main>
  )
}
