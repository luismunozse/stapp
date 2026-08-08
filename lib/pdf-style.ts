import { rgb, type PDFPage, type PDFFont, type RGB } from "pdf-lib";

// Monochrome system for A4 receipt PDFs.
// Spec: docs/superpowers/specs/2026-08-08-a4-receipts-monochrome-redesign-design.md
export const MONO: Record<"ink" | "label" | "faint" | "rule" | "totalBg" | "white", RGB> = {
  ink: rgb(0.067, 0.067, 0.067), // #111 body text
  label: rgb(0.333, 0.333, 0.333), // #555 section labels
  faint: rgb(0.6, 0.6, 0.6), // #999 fine print
  rule: rgb(0.8, 0.8, 0.8), // #ccc hairlines
  totalBg: rgb(0.949, 0.949, 0.949), // #f2f2f2 — the ONLY allowed area fill
  white: rgb(1, 1, 1),
};

export const TYPE = {
  docNumber: 18,
  docTitle: 10,
  sectionLabel: 6.5,
  body: 9,
  small: 8,
  fine: 6.5,
  total: 12,
} as const;

export const RULE_WIDTH = 0.5;

const BADGE_SIZE = 7;
const BADGE_PAD_X = 5;
const BADGE_PAD_Y = 3.5;

export function drawRule(
  page: PDFPage,
  x1: number,
  x2: number,
  y: number,
  opts?: { dotted?: boolean; color?: RGB; thickness?: number }
): void {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: opts?.thickness ?? RULE_WIDTH,
    color: opts?.color ?? MONO.rule,
    ...(opts?.dotted ? { dashArray: [1, 3] } : {}),
  });
}

export function drawSectionLabel(
  page: PDFPage,
  fontBold: PDFFont,
  text: string,
  x: number,
  y: number
): number {
  const label = text.toUpperCase();
  page.drawText(label, {
    x,
    y,
    size: TYPE.sectionLabel,
    font: fontBold,
    color: MONO.label,
  });
  return fontBold.widthOfTextAtSize(label, TYPE.sectionLabel);
}

export function measureBadgeWidth(
  fontBold: PDFFont,
  text: string,
  size: number = BADGE_SIZE
): number {
  return fontBold.widthOfTextAtSize(text.toUpperCase(), size) + BADGE_PAD_X * 2;
}

export function drawOutlinedBadge(
  page: PDFPage,
  fontBold: PDFFont,
  text: string,
  x: number,
  yTop: number,
  opts?: { size?: number }
): { width: number; height: number } {
  const size = opts?.size ?? BADGE_SIZE;
  const label = text.toUpperCase();
  const width = measureBadgeWidth(fontBold, text, size);
  const height = size + BADGE_PAD_Y * 2;
  page.drawRectangle({
    x,
    y: yTop - height,
    width,
    height,
    borderColor: MONO.ink,
    borderWidth: 0.75,
  });
  page.drawText(label, {
    x: x + BADGE_PAD_X,
    y: yTop - height + BADGE_PAD_Y + 0.5,
    size,
    font: fontBold,
    color: MONO.ink,
  });
  return { width, height };
}
