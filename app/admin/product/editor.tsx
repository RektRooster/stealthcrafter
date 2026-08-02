"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

const STAGES = ["pending", "product_identified", "supplier_route_approved"];
const STATUSES = ["draft", "researching", "testing", "approved", "listed", "rejected", "discontinued"];
const CONF = ["", "low", "medium", "high"];
const PILLARS = ["", "Water", "Fire", "Shelter", "Medical", "Food", "Support", "Novelty", "Hobby"];

function parseImages(v: any): string[] {
  if (!v) return [];
  const s = String(v);
  try { const j = JSON.parse(s); if (Array.isArray(j)) return j.filter(Boolean); } catch {}
  return s.match(/https?:\/\/[^\s,"'\]]+/g) || [];
}
function isHold(f: any): boolean {
  if (f.dangerous_goods) return true;
  const n = String(f.internal_notes || "").toUpperCase();
  return n.includes("COMPLIANCE") || n.includes("MEDICINE") || n.includes("POTASSIUM IODIDE");
}

export default function ProductEditor({
  product, categories, routes = [], sources = [], mode = "edit",
}: { product: any; categories: { id: number; name: string }[]; routes?: any[]; sources?: any[]; mode?: "edit" | "create" }) {
  const router = useRouter();
  const [f, setF] = useState<any>({ ...product });
  const [images, setImages] = useState<string[]>(parseImages(product.image_urls));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState("");

  const id = product.id;
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const retired = f.product_status === "rejected" || f.product_status === "discontinued";
  const hosted = images.some((u) => u.includes("/product-images/"));

  function flash(t: "ok" | "err", m: string) { setMsg({ t, m }); if (t === "ok") setTimeout(() => setMsg(null), 3500); }

  async function save(overrides?: any) {
    setBusy(true); setMsg(null);
    const patch = { ...f, ...(overrides || {}) };
    delete patch.category; // display-only
    try {
      const r = await fetch("/api/admin/product/save", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "create" ? { patch } : { id, patch }),
      });
      const j = await r.json();
      if (!r.ok) { flash("err", j.error || "Save failed"); setBusy(false); return; }
      if (mode === "create") { router.push(`/admin/product/${j.id}`); return; }
      if (overrides) setF((p: any) => ({ ...p, ...overrides }));
      flash("ok", "Saved"); router.refresh();
    } catch (e: any) { flash("err", e?.message || "Save failed"); }
    setBusy(false);
  }

  function approve() {
    if (isHold(f)) { flash("err", "Compliance-hold item (medicine / dangerous good) — cannot be approved here. Route to Compliance [08]."); return; }
    const warn: string[] = [];
    if (!f.retail_price_rrp && !f.landed_cost) warn.push("no price");
    if (!hosted) warn.push("no hosted image");
    if ((routes || []).length === 0) warn.push("no supplier route");
    if (warn.length && !confirm(`This product has: ${warn.join(", ")}.\n\nApprove anyway?`)) return;
    save({ product_status: "approved", needs_review: false });
  }

  async function imageAction(action: string, url?: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/product/image", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action, url }),
      });
      const j = await r.json();
      if (!r.ok) flash("err", j.error || "Image action failed");
      else { setImages(j.images || []); flash("ok", "Images updated"); router.refresh(); }
    } catch (e: any) { flash("err", e?.message || "failed"); }
    setBusy(false);
  }

  async function uploadFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("id", id); fd.append("file", file);
      const r = await fetch("/api/admin/product/image", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) flash("err", j.error || "Upload failed");
      else { setImages(j.images || []); flash("ok", "Image uploaded to storage"); router.refresh(); }
    } catch (e: any) { flash("err", e?.message || "Upload failed"); }
    setBusy(false);
  }

  const T = (k: string, label: string, opts: { area?: boolean; type?: string } = {}) => (
    <div className={`field ${opts.area ? "wide" : ""}`}>
      <label>{label}</label>
      {opts.area ? (
        <textarea value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} rows={4} />
      ) : (
        <input type={opts.type || "text"} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
      )}
    </div>
  );
  const S = (k: string, label: string, opts: string[]) => (
    <div className="field">
      <label>{label}</label>
      <select value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)}>
        {opts.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
      </select>
    </div>
  );
  const C = (k: string, label: string) => (
    <label className="chk"><input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked)} /> {label}</label>
  );

  return (
    <div className="container">
      <Link className="back" href="/admin">← Back to catalogue</Link>
      <div className="editor-head">
        <h2 className="pagetitle">{mode === "create" ? "New product" : (f.sc_product_name || f.product_name || "Unnamed product")}</h2>
        {mode === "edit" ? <span className={`badge st-${f.product_status}`}>{f.product_status}</span> : null}
        {isHold(f) ? <span className="badge flag">compliance-hold</span> : null}
      </div>

      {/* Action bar */}
      <div className="actionbar">
        <button className="primary" disabled={busy} onClick={() => save()}>{mode === "create" ? "Create product" : "Save changes"}</button>
        {mode === "edit" && !retired ? <button disabled={busy} onClick={approve}>Approve / finalise</button> : null}
        {mode === "edit" && !retired ? <button disabled={busy} onClick={() => save({ needs_review: false })}>Clear “needs review”</button> : null}
        {mode === "edit" && !retired ? <button className="danger" disabled={busy} onClick={() => { if (confirm("Move to the retired bin? (reversible)")) save({ product_status: "rejected" }); }}>Retire</button> : null}
        {mode === "edit" && retired ? <button disabled={busy} onClick={() => save({ product_status: "researching" })}>Restore from bin</button> : null}
        {msg ? <span className={`savemsg ${msg.t}`}>{msg.m}</span> : null}
      </div>

      <div className="edit-grid">
        <section className="card">
          <div className="section-h">Identity</div>
          <div className="fields">
            {T("sc_product_name", "Product name (SC)")}
            {T("product_name", "Product name (raw)")}
            <div className="field"><label>Category</label>
              <select value={f.category_id ?? ""} onChange={(e) => set("category_id", e.target.value)}>
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {S("pillar", "Pillar", PILLARS)}
            {T("subcategory", "Subcategory")}
            {T("product_type", "Product type")}
            {T("brand", "Brand")}
            {T("model", "Model")}
            {T("manufacturer", "Manufacturer")}
            {T("country_of_manufacture", "Country of manufacture")}
          </div>
        </section>

        <section className="card">
          <div className="section-h">Status &amp; flags</div>
          <div className="fields">
            {S("product_status", "Status", STATUSES)}
            {S("research_stage", "Research stage", STAGES)}
            {S("research_confidence", "Confidence", CONF)}
          </div>
          <div className="checks">
            {C("needs_review", "Needs review")}
            {C("safety_critical", "Safety critical")}
            {C("dangerous_goods", "Dangerous goods")}
            {C("ce_certified", "CE certified")}
            {C("images_complete", "Images complete")}
            {C("hero_product", "Hero product")}
          </div>
        </section>

        <section className="card">
          <div className="section-h">Commercial</div>
          <div className="fields">
            {T("retail_price_rrp", "RRP", { type: "number" })}
            {T("landed_cost", "Landed cost", { type: "number" })}
            {T("currency", "Currency")}
          </div>
        </section>

        <section className="card">
          <div className="section-h">Specification</div>
          <div className="fields">
            {T("dimensions", "Dimensions")}
            {T("weight", "Weight")}
            {T("materials", "Materials", { area: true })}
            {T("included_contents", "Included contents", { area: true })}
            {T("warranty", "Warranty")}
            {T("certifications_notes", "Certifications", { area: true })}
            {T("safety_notes", "Safety notes", { area: true })}
            {T("shelf_life", "Shelf life")}
            {T("sku", "SKU")}
            {T("barcode_ean", "EAN / barcode")}
          </div>
        </section>

        <section className="card">
          <div className="section-h">Notes</div>
          <div className="fields">
            {T("internal_notes", "Internal notes", { area: true })}
            {T("customer_notes", "Customer notes", { area: true })}
          </div>
        </section>

        {/* Images */}
        <section className="card">
          <div className="section-h">Images {hosted ? <span className="badge approved" style={{ marginLeft: 8 }}>hosted</span> : images.length ? <span className="badge review" style={{ marginLeft: 8 }}>not hosted</span> : null}</div>
          {mode === "create" ? (
            <p className="subtle">Save the product first, then you can upload images.</p>
          ) : (
            <>
              <div className="imgman">
                {images.length === 0 ? <p className="subtle">No images yet.</p> : images.map((u, i) => (
                  <div key={u} className="imgcard">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" />
                    <div className="imgbtns">
                      {i === 0 ? <span className="badge approved">primary</span> : <button disabled={busy} onClick={() => imageAction("primary", u)}>Set primary</button>}
                      <button className="danger" disabled={busy} onClick={() => { if (confirm("Remove this image?")) imageAction("delete", u); }}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="imgadd">
                <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadFile(file); e.currentTarget.value = ""; }} />
                <div className="urlrow">
                  <input type="url" placeholder="…or paste an image URL to host" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
                  <button disabled={busy || !urlInput} onClick={() => { imageAction("add-url", urlInput); setUrlInput(""); }}>Add &amp; host</button>
                </div>
                <p className="subtle">Uploads download into your Supabase storage bucket — nothing is hotlinked.</p>
              </div>
            </>
          )}
        </section>

        {/* Read-only supplier routes + provenance (edit in Phase 2) */}
        {mode === "edit" ? (
          <section className="card">
            <div className="section-h">Supplier routes ({(routes || []).length})</div>
            {(routes || []).length === 0 ? <p className="subtle">No supplier route recorded.</p> : (
              <table className="kv"><tbody>
                {routes.map((r: any) => (
                  <tr key={r.id}>
                    <td className="k">{r.role || "—"}{r.fulfilment_region ? ` · ${r.fulfilment_region}` : ""}</td>
                    <td>{r.supplier?.name || "—"}{r.wholesale_price != null ? ` · €${Number(r.wholesale_price).toFixed(2)}${r.vat_included === false ? " ex-VAT" : ""}` : ""}{r.stock_status ? ` · ${r.stock_status}` : ""}{r.source_url ? <> · <a href={r.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--brass)" }}>source</a></> : null}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
            <p className="subtle" style={{ marginTop: 8 }}>Editing supplier routes comes in the next phase.</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
