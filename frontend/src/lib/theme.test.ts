/**
 * The claim this feature makes is "upload ANY logo and get a readable, tasteful
 * theme". These tests are what turn that from a claim into a guarantee.
 *
 *   bun test
 *
 * The interesting cases are the hostile ones: a neon-yellow logo is the classic
 * way brand-adaptive theming produces white text on a highlighter, and a grey
 * logo is the classic way it produces a "brand" you cannot see at all.
 */
import { describe, expect, test } from "bun:test";

import { buildTheme, clampBrand, contrast, readableOn } from "./theme";

/** WCAG AA for large/bold text on a coloured background. */
const AA_LARGE = 3;

const HOSTILE_LOGOS = [
  ["#FFEB3B", "neon yellow"],
  ["#CDDC39", "lime"],
  ["#00FFFF", "neon cyan"],
  ["#FF0090", "hot magenta"],
  ["#FFFFFF", "pure white"],
  ["#000000", "pure black"],
  ["#8A8A8A", "mid grey"],
  ["#FF6F00", "amber"],
  ["#E53935", "red"],
  ["#7B1FA2", "purple"],
  ["#1a237e", "navy"],
  ["#0d9488", "the default itself"],
] as const;

describe("clampBrand — every logo yields a legible brand", () => {
  for (const [hex, label] of HOSTILE_LOGOS) {
    test(`white text on the brand from ${label} (${hex}) clears WCAG AA`, () => {
      const brand = clampBrand(hex);
      expect(contrast(brand, "#ffffff")).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }

  test("the DEFAULT brand carries white text", () => {
    // Guards a real bug that shipped once: #14b8a6 is the obvious teal, looks
    // lovely, and scores 2.49:1 — below AA. Every primary button uses white text,
    // so the default must clear the bar too.
    const fallback = clampBrand("#8A8A8A"); // grey → the default
    expect(contrast(fallback, "#ffffff")).toBeGreaterThanOrEqual(AA_LARGE);
  });

  test("the hue is preserved — a red brand stays red", () => {
    // The clamp adjusts saturation and lightness, never hue. Hue is the part a
    // company actually recognises as theirs.
    const red = clampBrand("#E53935");
    const { r, g, b } = {
      r: parseInt(red.slice(1, 3), 16),
      g: parseInt(red.slice(3, 5), 16),
      b: parseInt(red.slice(5, 7), 16),
    };

    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  test("a grey logo falls back rather than producing a grey 'brand'", () => {
    expect(clampBrand("#8A8A8A")).toBe(clampBrand("#FFFFFF"));
  });
});

describe("buildTheme", () => {
  test("produces the full ramp plus semantic tokens", () => {
    const theme = buildTheme("#FFEB3B");

    for (const step of ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"]) {
      expect(theme[`brand-${step}`]).toMatch(/^#[0-9a-f]{6}$/);
    }

    expect(theme.primary).toBe(theme["brand-500"]!);
    expect(theme.onPrimary).toBeDefined();
  });

  test("onPrimary picks the readable text colour for the brand", () => {
    // A dark navy brand takes white text; a light one takes near-black.
    expect(readableOn(clampBrand("#1a237e"))).toBe("#ffffff");
    expect(buildTheme("#1a237e").onPrimary).toBe("#ffffff");
  });

  test("shades get darker as the ramp ascends", () => {
    const theme = buildTheme("#2563eb");
    const luminanceOf = (hex: string) => contrast(hex, "#000000");

    expect(luminanceOf(theme["brand-700"]!)).toBeLessThan(luminanceOf(theme["brand-500"]!));
    expect(luminanceOf(theme["brand-900"]!)).toBeLessThan(luminanceOf(theme["brand-700"]!));
  });
});

describe("contrast", () => {
  test("matches the known WCAG anchors", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 1);
  });
});
