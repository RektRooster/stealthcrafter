/* Shared pure helpers for the Test Lab (client-safe). */

export function firstImage(image_urls: any): string | null {
  if (!image_urls) return null;
  const m = String(image_urls).match(/https?:\/\/[^\s,"'\]]+/);
  return m ? m[0] : null;
}

export function displayName(p: any): string {
  if (!p) return "Unknown product";
  return p.sc_product_name || p.product_name || p.example_product || "Unnamed product";
}

export function scId(p: any): string {
  if (!p) return "—";
  return p.sku || `SC-${String(p.id || "").slice(0, 8).toUpperCase()}`;
}

export function highPriority(p: any): boolean {
  return Boolean(p && (p.hero_product || p.safety_critical));
}

export const RESULT_META: Record<string, { label: string; tone: string }> = {
  waiting: { label: "WAITING", tone: "muted" },
  in_progress: { label: "IN PROGRESS", tone: "cyan" },
  pass: { label: "PASS", tone: "green" },
  fail: { label: "FAIL", tone: "red" },
  na: { label: "N/A", tone: "amber" },
};

export const RESOLVED_RESULTS = new Set(["pass", "fail", "na"]);

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} ${d
    .toTimeString()
    .slice(0, 5)}`;
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function verdictMeta(v: string | null | undefined): { label: string; tone: string } {
  if (v === "pass") return { label: "PASS", tone: "green" };
  if (v === "fail") return { label: "FAIL", tone: "red" };
  if (v === "review") return { label: "REVIEW", tone: "amber" };
  return { label: "—", tone: "muted" };
}
