import { supabaseAdmin } from "./supabase";

export const BUCKET = "product-images";

// Columns the admin editor is allowed to write. Anything else in a payload is ignored.
const ALLOWED = new Set<string>([
  "sc_product_name", "product_name", "brand", "model", "version",
  "manufacturer", "manufacturer_website", "country_of_manufacture",
  "category_id", "subcategory", "product_type", "description",
  "retail_price_rrp", "landed_cost", "currency",
  "dimensions", "weight", "materials", "included_contents", "warranty",
  "certifications_notes", "safety_notes", "shelf_life", "sku", "barcode_ean",
  "search_keywords",
  "research_stage", "product_status", "research_confidence",
  "needs_review", "safety_critical", "dangerous_goods", "ce_certified",
  "images_complete", "hero_product",
  "internal_notes", "customer_notes", "image_urls",
]);
const NUMERIC = new Set(["retail_price_rrp", "landed_cost", "category_id"]);
const BOOLEAN = new Set(["needs_review", "safety_critical", "dangerous_goods", "ce_certified", "images_complete", "hero_product"]);

function clean(patch: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!ALLOWED.has(k)) continue;
    if (NUMERIC.has(k)) out[k] = v === "" || v === null || v === undefined ? null : Number(v);
    else if (BOOLEAN.has(k)) out[k] = Boolean(v);
    else out[k] = v === "" ? null : v;
  }
  return out;
}

// Compliance-hold = must never be auto/one-click approved (medicines, KI, dangerous goods).
export function isComplianceHold(p: any): boolean {
  if (!p) return false;
  if (p.dangerous_goods === true) return true;
  const notes = String(p.internal_notes || "").toUpperCase();
  return notes.includes("COMPLIANCE") || notes.includes("MEDICINE") || notes.includes("POTASSIUM IODIDE");
}

export function parseImages(image_urls: any): string[] {
  if (!image_urls) return [];
  const s = String(image_urls);
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j.filter(Boolean);
  } catch {}
  return s.match(/https?:\/\/[^\s,"'\]]+/g) || [];
}

export async function updateProduct(id: string, patch: Record<string, any>, reviewer = "admin") {
  const sb = supabaseAdmin();
  if (!sb) throw new Error("no db");
  const body = clean(patch);
  // Server-side compliance guard: block approving a compliance-hold item.
  if (body.product_status === "approved") {
    const { data: cur } = await sb.from("products").select("internal_notes,dangerous_goods").eq("id", id).maybeSingle();
    const merged = { ...cur, ...body };
    if (isComplianceHold(merged)) {
      throw new Error("compliance_hold: this item is a medicine/dangerous-good and cannot be approved from the console — route it to Compliance [08].");
    }
  }
  body.updated_at = new Date().toISOString();
  body.last_reviewed = new Date().toISOString().slice(0, 10);
  body.reviewed_by = reviewer;
  const { error } = await sb.from("products").update(body).eq("id", id);
  if (error) throw error;
  return { ok: true };
}

export async function createProduct(patch: Record<string, any>, reviewer = "admin") {
  const sb = supabaseAdmin();
  if (!sb) throw new Error("no db");
  const body = clean(patch);
  if (!body.sc_product_name && !body.product_name) throw new Error("A product name is required.");
  body.currency = body.currency || "EUR";
  body.product_status = body.product_status || "draft";
  body.research_stage = body.research_stage || "pending";
  body.date_added = new Date().toISOString();
  body.created_at = new Date().toISOString();
  body.updated_at = new Date().toISOString();
  body.reviewed_by = reviewer;
  const { data, error } = await sb.from("products").insert(body).select("id").single();
  if (error) throw error;
  return { ok: true, id: data.id };
}

async function ensureBucket(sb: any) {
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b: any) => b.name === BUCKET)) {
    await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  }
}

async function appendHosted(sb: any, id: string, publicUrl: string) {
  const { data: prod } = await sb.from("products").select("image_urls").eq("id", id).maybeSingle();
  const cur = parseImages(prod?.image_urls);
  const next = [...cur.filter((u) => u !== publicUrl), publicUrl];
  await sb.from("products").update({ image_urls: JSON.stringify(next), images_complete: true, updated_at: new Date().toISOString() }).eq("id", id);
  return next;
}

// Upload a file's bytes into the bucket and append the hosted URL.
export async function uploadImageBytes(id: string, bytes: Uint8Array, contentType: string) {
  const sb = supabaseAdmin();
  if (!sb) throw new Error("no db");
  await ensureBucket(sb);
  let ext = (contentType.split("/")[1] || "jpg").split(";")[0].trim();
  if (ext === "jpeg") ext = "jpg";
  const path = `${id}_${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
  const publicUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const images = await appendHosted(sb, id, publicUrl);
  return { ok: true, url: publicUrl, images };
}

// Fetch a remote image URL server-side and host it into the bucket.
export async function addImageFromUrl(id: string, src: string) {
  const sb = supabaseAdmin();
  if (!sb) throw new Error("no db");
  const r = await fetch(src);
  if (!r.ok) throw new Error(`could not fetch image (${r.status})`);
  const ct = r.headers.get("content-type") || "image/jpeg";
  if (!ct.startsWith("image/")) throw new Error("that URL is not an image");
  const bytes = new Uint8Array(await r.arrayBuffer());
  return uploadImageBytes(id, bytes, ct);
}

export async function removeImage(id: string, url: string) {
  const sb = supabaseAdmin();
  if (!sb) throw new Error("no db");
  const { data: prod } = await sb.from("products").select("image_urls").eq("id", id).maybeSingle();
  const cur = parseImages(prod?.image_urls);
  const next = cur.filter((u) => u !== url);
  // If it was a hosted file, delete it from storage too.
  const marker = `/${BUCKET}/`;
  if (url.includes(marker)) {
    const path = url.split(marker)[1];
    if (path) await sb.storage.from(BUCKET).remove([path]).catch(() => {});
  }
  await sb.from("products").update({
    image_urls: next.length ? JSON.stringify(next) : null,
    images_complete: next.length > 0,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  return { ok: true, images: next };
}

export async function setPrimaryImage(id: string, url: string) {
  const sb = supabaseAdmin();
  if (!sb) throw new Error("no db");
  const { data: prod } = await sb.from("products").select("image_urls").eq("id", id).maybeSingle();
  const cur = parseImages(prod?.image_urls);
  if (!cur.includes(url)) return { ok: true, images: cur };
  const next = [url, ...cur.filter((u) => u !== url)];
  await sb.from("products").update({ image_urls: JSON.stringify(next), updated_at: new Date().toISOString() }).eq("id", id);
  return { ok: true, images: next };
}
