import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  MONO, TYPE, RULE_WIDTH,
  drawRule, drawSectionLabel, drawOutlinedBadge, measureBadgeWidth,
} from "@/lib/pdf-style";

describe("pdf-style", () => {
  it("exposes the monochrome palette from the spec", () => {
    expect(MONO.ink.red).toBeCloseTo(0.067, 3);
    expect(MONO.label.red).toBeCloseTo(0.333, 3);
    expect(MONO.faint.red).toBeCloseTo(0.6, 3);
    expect(MONO.rule.red).toBeCloseTo(0.8, 3);
    expect(MONO.totalBg.red).toBeCloseTo(0.949, 3);
    expect(TYPE.docNumber).toBe(18);
    expect(TYPE.sectionLabel).toBe(6.5);
    expect(RULE_WIDTH).toBe(0.5);
  });

  it("draws helpers without throwing and reports badge width", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    drawRule(page, 40, 555, 800);
    drawRule(page, 40, 555, 790, { dotted: true });
    drawSectionLabel(page, bold, "Cliente", 40, 780);
    const badge = drawOutlinedBadge(page, bold, "Recepción", 40, 770);
    expect(badge.width).toBeGreaterThan(20);
    expect(badge.height).toBeGreaterThan(10);
    expect(measureBadgeWidth(bold, "Recepción")).toBeCloseTo(badge.width, 5);
    const bytes = await doc.save();
    expect(bytes.length).toBeGreaterThan(500);
  });
});
