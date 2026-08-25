// StealthCrafter palette — colour-blind safe.
//
// Categorical and status colours come from the Okabe-Ito set, which is designed
// so every pair stays distinguishable under deuteranopia, protanopia and
// tritanopia. Two rules go with it and matter more than the hues themselves:
//
//   1. Colour is NEVER the only signal. Every status also carries a word, a
//      mark (✓ × –), a position or a shape.
//   2. Ordered scales move in lightness as well as hue, so they survive being
//      seen as a single hue.
//
// Keep this file and the :root tokens in app/globals.css in step — the CSS
// paints the chrome, this paints the SVG instruments.

/* Okabe-Ito reference set */
export const OI = {
  blue: "#0072B2",
  skyBlue: "#56B4E9",
  bluishGreen: "#009E73",
  orange: "#E69F00",
  vermilion: "#D55E00",
  reddishPurple: "#CC79A7",
  yellow: "#F0E442",
  black: "#111111",
} as const;

/* Severity — ordered cool → warm, so it reads as a ramp even without hue. */
export const SEVERITY: Record<string, string> = {
  info: OI.skyBlue,
  watch: OI.blue,
  elevated: OI.orange,
  severe: OI.vermilion,
};

/* Pass / miss. Bluish-green against vermilion is safe in every common form,
   and both are always paired with a ✓ or × in the UI. */
export const OK = OI.bluishGreen;
export const BAD = OI.vermilion;
export const NEUTRAL = "#7d8894";

/* The five preparedness pillars. */
export const PILLARS: Record<string, string> = {
  Water: OI.blue,
  Food: OI.bluishGreen,
  Fire: OI.vermilion,
  Shelter: OI.reddishPurple,
  Medical: OI.orange,
};

/* Hazard sources — each also carries its own name on every chip. */
export const SOURCES: Record<string, string> = {
  EFFIS: OI.vermilion,
  EMSC: OI.blue,
  GDACS: OI.reddishPurple,
  ENTSOE: OI.orange,
  TRANSPORT: OI.bluishGreen,
};

/* Map surfaces — separated by warmth AND lightness, not hue alone. */
export const MAP = {
  seaFrom: "#c9d7e3",
  seaTo: "#b9cad9",
  landEu: "#efe7d4",
  landContext: "#dbe2e8",
  strokeEu: "#a98f57",
  strokeContext: "#8fa0b0",
  label: "#2a3742",
} as const;

export const INK = "#16202b";
export const INK_MUTED = "#5b6874";
export const BRASS = "#8a6a28";
