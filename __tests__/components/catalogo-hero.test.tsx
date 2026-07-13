import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CatalogoHero } from "@/components/catalogo-public/catalogo-hero"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, priority: _priority, sizes: _sizes, ...rest } = props
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />
  },
}))

const baseProps = {
  bannerUrl: null,
  logoUrl: null,
  titulo: "TecnoCel",
  descripcion: "Servicio técnico",
  whatsapp: "5493815551234",
  brandColor: "#2563eb",
  shareUrl: "https://tecnocel.stapp.com.ar",
  trustBadges: [{ icon: "shield", label: "Garantía 6 meses" }],
}

describe("CatalogoHero — warm commercial v2", () => {
  it("renders the WhatsApp CTA green and BEFORE the share button", () => {
    render(<CatalogoHero {...baseProps} />)
    const wa = screen.getByRole("link", { name: /whatsapp/i })
    const share = screen.getByRole("button", { name: /compartir/i })
    expect(wa.className).toContain("bg-whatsapp")
    // WhatsApp is the primary action: it must precede Share in the DOM.
    expect(wa.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wa).toHaveAttribute("href", "https://wa.me/5493815551234")
  })

  it("renders trust badges as warm chips", () => {
    render(<CatalogoHero {...baseProps} />)
    const chip = screen.getByText("Garantía 6 meses").closest("li")!
    expect(chip.className).toContain("rounded-full")
    expect(chip.className).toContain("bg-cat-surface")
    expect(chip.className).toContain("border-cat-border")
  })

  it("title uses the display font in the no-banner variant", () => {
    render(<CatalogoHero {...baseProps} />)
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("font-display")
  })

  it("renders the WhatsApp CTA before a VISIBLE share button in the banner variant", () => {
    render(<CatalogoHero {...baseProps} bannerUrl="https://example.com/banner.jpg" />)
    const wa = screen.getByRole("link", { name: /whatsapp/i })
    const share = screen.getByRole("button", { name: /compartir/i })
    expect(wa.className).toContain("bg-whatsapp")
    expect(wa.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The alpha modifier on cat-surface silently fails (var() without <alpha-value>),
    // so the button must use the solid class, never the broken alpha variant.
    expect(share.className).toContain("bg-cat-surface")
    expect(share.className).not.toContain("bg-cat-surface/90")
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("font-display")
  })
})
