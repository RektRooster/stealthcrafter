// Flag emoji from an ISO2 code via regional-indicator codepoints. Client-safe.
export function flagEmoji(iso2: string): string {
  const code = (iso2 || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "🏳";
  return String.fromCodePoint(
    0x1f1e6 + (code.charCodeAt(0) - 65),
    0x1f1e6 + (code.charCodeAt(1) - 65)
  );
}
