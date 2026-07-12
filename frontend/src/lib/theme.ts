/**
 * Brand-adaptive theming: an organization's logo becomes the app's palette.
 *
 * The extraction runs in the BROWSER, not on the server. node-vibrant on the
 * server pulls in native image decoders (sharp/jimp) that are a real risk under
 * Bun on alpine — and the browser already has an image decoder. We send the
 * derived tokens up as JSON alongside the file, so the backend only ever stores
 * text and bytes.
 *
 * The intelligence is in the CLAMPING. A naive implementation takes the logo's
 * dominant colour and paints buttons with it — and a company with a pale-yellow
 * logo gets white text on yellow, which nobody can read. Everything below exists
 * to guarantee a legible, tasteful result from ANY logo.
 */

// ── colour maths ────────────────────────────────────────────────────────────

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

export const rgbToHex = ({ r, g, b }: Rgb) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
  }

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];

  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  const [light, dark] = la > lb ? [la, lb] : [lb, la];

  return (light + 0.05) / (dark + 0.05);
}

/** The readable text colour to sit ON a given background. */
export const readableOn = (background: string): "#ffffff" | "#10131a" =>
  contrast(background, "#ffffff") >= 4.5 ? "#ffffff" : "#10131a";

// ── the clamp ───────────────────────────────────────────────────────────────

/**
 * The fallback brand, used when a logo has no usable hue (a white, black, or grey
 * logo). It is NOT the obvious teal #14b8a6: that scores only 2.49:1 against white
 * text, which looks perfectly nice and is quietly below WCAG AA. This one is
 * 3.74:1. See theme.test.ts.
 */
const DEFAULT_BRAND = "#0d9488";

const HSL = (h: number, s: number, l: number) => rgbToHex(hslToRgb({ h, s, l }));

/**
 * Force a brand colour into a range that can carry white text and still look
 * like itself.
 *
 * Two failure modes this prevents:
 *
 *  • A neon logo (s = 1.0, l = 0.7) → buttons that vibrate and text you cannot
 *    read. Saturation is capped and lightness pulled down.
 *  • A near-white or near-black logo → a "brand" indistinguishable from the page.
 *    Lightness is pushed back toward the middle.
 *
 * The hue is never changed. That is the part a company actually recognises as
 * theirs; everything else is negotiable.
 */
export function clampBrand(hex: string): string {
  const { h, s, l } = rgbToHsl(hexToRgb(hex));

  // A grey/white/black logo has no usable hue — fall back to the default teal
  // rather than rendering a grey "accent" that reads as broken.
  if (s < 0.08) return DEFAULT_BRAND;

  const saturation = Math.min(Math.max(s, 0.35), 0.85);
  let lightness = Math.min(Math.max(l, 0.32), 0.58);

  // Yellows and limes are perceptually far brighter than their lightness value
  // suggests — the classic case where white-on-brand becomes unreadable. Darken
  // that hue band further.
  if (h >= 45 && h <= 75) lightness = Math.min(lightness, 0.42);

  let candidate = HSL(h, saturation, lightness);

  // Final guarantee: white text on this colour must clear WCAG AA for large text
  // (3:1). Walk it darker until it does, rather than shipping something unreadable.
  let guard = 0;
  while (contrast(candidate, "#ffffff") < 3 && lightness > 0.2 && guard++ < 20) {
    lightness -= 0.02;
    candidate = HSL(h, saturation, lightness);
  }

  return candidate;
}

/** Builds the 50→900 ramp around a clamped brand colour. */
export function buildRamp(brand: string): Record<string, string> {
  const { h, s } = rgbToHsl(hexToRgb(brand));

  const steps: Array<[string, number]> = [
    ["50", 0.96],
    ["100", 0.9],
    ["200", 0.8],
    ["300", 0.68],
    ["400", 0.58],
    ["500", 0], // the clamped brand itself
    ["600", -0.08],
    ["700", -0.16],
    ["800", -0.24],
    ["900", -0.3],
  ];

  const base = rgbToHsl(hexToRgb(brand)).l;

  return Object.fromEntries(
    steps.map(([step, target]) => [
      step,
      step === "500"
        ? brand
        : HSL(
            h,
            // Tints lose a little saturation; shades keep it.
            target > 0.6 ? Math.max(s * 0.55, 0.15) : s,
            target > 0 ? target : Math.max(0.12, base + target),
          ),
    ]),
  );
}

export type Theme = Record<string, string>;

/** The token set stored on the Organization row and applied to the DOM. */
export function buildTheme(primaryHex: string, accentHex?: string): Theme {
  const brand = clampBrand(primaryHex);
  const ramp = buildRamp(brand);

  return {
    ...Object.fromEntries(Object.entries(ramp).map(([step, hex]) => [`brand-${step}`, hex])),
    primary: brand,
    accent: accentHex ? clampBrand(accentHex) : ramp["700"]!,
    onPrimary: readableOn(brand),
  };
}

/**
 * Applies the theme by setting CSS custom properties on <html>.
 *
 * Every Tailwind colour utility in the app reads these through `@theme inline`,
 * so this single call re-skins the entire product — instantly, with no re-render
 * and no rebuild. That is the whole payoff of the `inline` keyword in globals.css.
 */
export function applyTheme(theme: Theme | null | undefined): void {
  const root = document.documentElement;

  if (!theme) return;

  for (const [key, value] of Object.entries(theme)) {
    if (key === "onPrimary") continue;
    root.style.setProperty(`--${key}`, value);
  }

  if (theme.primary) root.style.setProperty("--brand-500", theme.primary);
  if (theme.accent) root.style.setProperty("--accent-500", theme.accent);
}

/**
 * Extracts a brand colour from an uploaded logo, in the browser.
 *
 * node-vibrant returns several swatches; Vibrant is the one a human would call
 * "the brand colour", with DarkVibrant and Muted as fallbacks for logos that are
 * mostly flat or monochrome.
 */
export async function themeFromLogo(file: File): Promise<Theme> {
  const { Vibrant } = await import("node-vibrant/browser");

  const url = URL.createObjectURL(file);

  try {
    const palette = await Vibrant.from(url).getPalette();

    const primary =
      palette.Vibrant?.hex ??
      palette.DarkVibrant?.hex ??
      palette.Muted?.hex ??
      palette.DarkMuted?.hex ??
      DEFAULT_BRAND;

    const accent = palette.DarkVibrant?.hex ?? palette.LightVibrant?.hex;

    return buildTheme(primary, accent);
  } finally {
    URL.revokeObjectURL(url);
  }
}
