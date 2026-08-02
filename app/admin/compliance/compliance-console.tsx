"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CcIcon } from "../cc-chrome";
import type {
  ComplianceConsoleData,
  ComplianceItem,
  ComplianceStatus,
  FlaggedProduct,
} from "@/lib/compliance-data";

/* ---------- presentation meta ---------- */

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "OPEN", cls: "cc-chip amber" },
  in_review: { label: "IN REVIEW", cls: "cc-chip cyan" },
  cleared: { label: "CLEARED", cls: "cc-chip green" },
  blocked: { label: "BLOCKED", cls: "cc-chip red" },
};

function StatusChip({ s }: { s: string }) {
  const meta = STATUS_META[s] || STATUS_META.open;
  return <span className={meta.cls}>{meta.label}</span>;
}

function SeverityChip({ s }: { s: string }) {
  return s === "gate" ? (
    <span className="cc-chip red plain">GATE</span>
  ) : (
    <span className="cc-chip amber plain">WATCH</span>
  );
}

function CategoryChip({ c }: { c: string }) {
  return <span className="cc-chip muted plain sm">{c.replace(/-/g, " ").toUpperCase()}</span>;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return d.slice(0, 10);
}

/* ---------- component ---------- */

type FlagSortKey = "severity" | "product" | "status";

function flagScore(p: FlaggedProduct): number {
  // HOLD outranks DG outranks SAFETY — mirrors what actually blocks approval.
  return (p.hold ? 4 : 0) + (p.dangerous_goods ? 2 : 0) + (p.safety_critical ? 1 : 0);
}

export default function ComplianceConsole({ data }: { data: ComplianceConsoleData }) {
  const router = useRouter();
  const [items, setItems] = useState<ComplianceItem[]>(data.items);
  const [selectedId, setSelectedId] = useState<string | null>(data.items[0]?.id ?? null);
  const sel = useMemo(() => items.find((i) => i.id === selectedId) || null, [items, selectedId]);

  /* ---- ruling form drafts (reset when selection changes) ---- */
  const [statusDraft, setStatusDraft] = useState<ComplianceStatus>("open");
  const [rulingDraft, setRulingDraft] = useState("");
  const [ruledByDraft, setRuledByDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setStatusDraft((sel?.status as ComplianceStatus) || "open");
    setRulingDraft(sel?.ruling || "");
    setRuledByDraft(sel?.ruled_by || "");
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function saveRuling() {
    if (!sel) return;
    const ruling = rulingDraft.trim();
    const ruledBy = ruledByDraft.trim();
    if (ruling && !ruledBy) {
      setMsg({ ok: false, text: "RULED BY is required to save a ruling." });
      return;
    }
    setSaving(true);
    setMsg(null);
    const patch: Record<string, string | null> = {
      status: statusDraft,
      ruling: ruling || null,
      ruled_by: ruledBy || null,
    };
    try {
      const res = await fetch("/api/admin/compliance/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sel.id, patch }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const now = new Date().toISOString();
      setItems((rs) =>
        rs.map((r) =>
          r.id === sel.id
            ? {
                ...r,
                status: statusDraft,
                ruling: ruling || null,
                ruled_by: ruledBy || null,
                ruled_at: ruling && ruledBy ? now : r.ruled_at,
                updated_at: now,
              }
            : r
        )
      );
      setMsg({ ok: true, text: ruling ? "Ruling saved to the register." : "Register item updated." });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Save failed." });
    }
    setSaving(false);
  }

  /* ---- add-item form ---- */
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addCategory, setAddCategory] = useState("governance");
  const [addSeverity, setAddSeverity] = useState("watch");
  const [addDetail, setAddDetail] = useState("");
  const [addMatch, setAddMatch] = useState("");
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function addItem() {
    if (!addTitle.trim()) {
      setAddMsg({ ok: false, text: "A title is required." });
      return;
    }
    setAdding(true);
    setAddMsg(null);
    try {
      const res = await fetch("/api/admin/compliance/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          title: addTitle.trim(),
          category: addCategory,
          severity: addSeverity,
          detail: addDetail.trim() || null,
          product_match: addMatch.trim() || "%",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const now = new Date().toISOString();
      const pattern = addMatch.trim() || "%";
      const generic = pattern.replace(/[%_]/g, "") === "";
      const newItem: ComplianceItem = {
        id: String(body.id),
        title: addTitle.trim(),
        category: addCategory,
        detail: addDetail.trim() || null,
        status: "open",
        severity: addSeverity as ComplianceItem["severity"],
        owner: "SC 08",
        product_match: pattern,
        ruling: null,
        ruled_by: null,
        ruled_at: null,
        created_at: now,
        updated_at: now,
        affectedCount: generic ? null : 0,
        affected: [],
      };
      setItems((rs) => [newItem, ...rs]);
      setSelectedId(newItem.id);
      setAddTitle("");
      setAddDetail("");
      setAddMatch("");
      setAddMsg({ ok: true, text: "Item added to the register for SC 08." });
      router.refresh(); // server recomputes the live affected-product count
    } catch (e: any) {
      setAddMsg({ ok: false, text: e?.message || "Add failed." });
    }
    setAdding(false);
  }

  /* ---- flagged products sort ---- */
  const [flagSort, setFlagSort] = useState<FlagSortKey>("severity");
  const [flagDir, setFlagDir] = useState<1 | -1>(1);
  const flagged = useMemo(() => {
    const arr = [...data.flagged];
    if (flagSort === "severity")
      arr.sort((a, b) => flagDir * (flagScore(b) - flagScore(a)) || a.name.localeCompare(b.name));
    else if (flagSort === "product") arr.sort((a, b) => flagDir * a.name.localeCompare(b.name));
    else
      arr.sort(
        (a, b) =>
          flagDir * String(a.product_status || "~").localeCompare(String(b.product_status || "~")) ||
          a.name.localeCompare(b.name)
      );
    return arr;
  }, [data.flagged, flagSort, flagDir]);

  function toggleFlagSort(k: FlagSortKey) {
    if (flagSort === k) setFlagDir((d) => (d === 1 ? -1 : 1));
    else {
      setFlagSort(k);
      setFlagDir(1);
    }
  }

  function FlagTh({ k, children }: { k: FlagSortKey; children: React.ReactNode }) {
    const active = flagSort === k;
    return (
      <th
        className="cc-sup-sorth"
        onClick={() => toggleFlagSort(k)}
        role="button"
        aria-sort={active ? (flagDir === 1 ? "ascending" : "descending") : undefined}
      >
        {children}
        <span className={`arr${active ? " on" : ""}`}>{active && flagDir === -1 ? "▼" : "▲"}</span>
      </th>
    );
  }

  const { stats, restrictions, jimmy } = data;
  const restrictedTotal = restrictions.shippingCount + restrictions.exportCount;

  return (
    <main className="cc-container">
      {/* ---------- header ---------- */}
      <div className="cc-modhead">
        <span className="cc-modicon">
          <CcIcon name="compliance" size={22} />
        </span>
        <div>
          <h1>COMPLIANCE</h1>
          <div className="sub">
            Exposure console &amp; SC 08 register — holds, dangerous goods, CE coverage, restrictions and AI-safety
            posture computed live from the catalogue
          </div>
        </div>
      </div>

      {/* ---------- ownership banner ---------- */}
      <div className="cc-comp-banner">
        SC 08 — Compliance &amp; Credibility owns rulings. This console surfaces live exposure and tracks the
        register; it does not make legal decisions.
      </div>

      {/* ---------- stat tiles ---------- */}
      <div className="cc-stats">
        <div className="cc-stat red">
          <div className="n">{stats.holds}</div>
          <div className="l">Compliance Holds</div>
        </div>
        <div className="cc-stat red">
          <div className="n">{stats.dangerousGoods}</div>
          <div className="l">Dangerous Goods</div>
        </div>
        <div className="cc-stat amber">
          <div className="n">{stats.safetyCritical}</div>
          <div className="l">Safety Critical</div>
        </div>
        <div className="cc-stat green">
          <div className="n">
            {stats.ceCertified} <span style={{ fontSize: 13, color: "var(--cc-muted)" }}>of {stats.total}</span>
          </div>
          <div className="l">CE Certified</div>
        </div>
        <div className="cc-stat amber">
          <div className="n">{stats.ageRestricted}</div>
          <div className="l">Age Restricted</div>
        </div>
        <div className={`cc-stat ${stats.openGateItems > 0 ? "red" : "cyan"}`}>
          <div className="n">{stats.openItems}</div>
          <div className="l">Open Register Items</div>
          {stats.openGateItems > 0 ? (
            <div className="l" style={{ color: "var(--cc-red)", marginTop: 2 }}>
              {stats.openGateItems} GATE
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------- register + detail drawer ---------- */}
      <div className="cc-detailgrid">
        <div className="cc-panel cc-span7">
          <div className="cc-panel-h">
            <CcIcon name="compliance" />
            Compliance Register
            <span className="right">OWNED BY SC 08 · CLICK A ROW FOR DETAIL &amp; RULING</span>
          </div>
          <div className="cc-tablewrap">
            <table className="cc-table cc-comp-regtable">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Affected</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className={it.id === selectedId ? "sel" : ""} onClick={() => setSelectedId(it.id)}>
                    <td className="cc-comp-title">{it.title}</td>
                    <td>
                      <CategoryChip c={String(it.category)} />
                    </td>
                    <td>
                      <SeverityChip s={it.severity} />
                    </td>
                    <td>
                      <StatusChip s={it.status} />
                    </td>
                    <td className="cc-war-num">{it.affectedCount == null ? "—" : it.affectedCount}</td>
                    <td className="cc-war-num">{fmtDate(it.updated_at)}</td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <span className="cc-empty">Register empty — add the first item below.</span>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="cc-war-note">
            AFFECTED = live count of catalogue products the item&apos;s match pattern hits (name or internal notes).
            &ldquo;—&rdquo; = register-wide item, not product-specific.
          </div>

          {/* ---- add item ---- */}
          <div className="cc-panel-h" style={{ marginTop: 14 }}>
            <CcIcon name="settings" />
            Add Register Item
            <button type="button" className="cc-btn ghost" style={{ marginLeft: "auto" }} onClick={() => setAddOpen((v) => !v)}>
              {addOpen ? "CLOSE" : "ADD ITEM"}
            </button>
          </div>
          {addOpen ? (
            <div className="cc-map-edit">
              <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
                <label>
                  <span>Title</span>
                  <input
                    type="text"
                    className="cc-input"
                    placeholder="What needs an SC 08 ruling?"
                    value={addTitle}
                    onChange={(e) => setAddTitle(e.target.value)}
                  />
                </label>
                <label>
                  <span>Category</span>
                  <select className="cc-input" value={addCategory} onChange={(e) => setAddCategory(e.target.value)}>
                    <option value="medicine">MEDICINE</option>
                    <option value="biocide">BIOCIDE</option>
                    <option value="ppe">PPE</option>
                    <option value="medical-device">MEDICAL DEVICE</option>
                    <option value="ai-safety">AI SAFETY</option>
                    <option value="governance">GOVERNANCE</option>
                  </select>
                </label>
                <label>
                  <span>Severity</span>
                  <select className="cc-input" value={addSeverity} onChange={(e) => setAddSeverity(e.target.value)}>
                    <option value="watch">WATCH</option>
                    <option value="gate">GATE</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span>Detail</span>
                <textarea
                  className="cc-input"
                  rows={3}
                  placeholder="Regulation, obligation, exposure — what SC 08 needs to rule on…"
                  value={addDetail}
                  onChange={(e) => setAddDetail(e.target.value)}
                />
              </label>
              <label className="block">
                <span>Product match (ilike pattern — e.g. %micropur% · leave blank for register-wide)</span>
                <input
                  type="text"
                  className="cc-input"
                  placeholder="%pattern%"
                  value={addMatch}
                  onChange={(e) => setAddMatch(e.target.value)}
                />
              </label>
              <div className="foot">
                <button type="button" className="cc-btn primary" onClick={addItem} disabled={adding}>
                  {adding ? "Adding…" : "Add To Register"}
                </button>
                {addMsg ? <span className={`savemsg ${addMsg.ok ? "ok" : "err"}`}>{addMsg.text}</span> : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* ---- detail drawer ---- */}
        <div className="cc-panel cc-span5 cc-comp-detail">
          {sel ? (
            <>
              <div className="cc-panel-h">
                <CcIcon name="compliance" />
                Register Item
                <span className="right">{sel.owner || "SC 08"}</span>
              </div>
              <h2 className="cc-comp-detailtitle">{sel.title}</h2>
              <div className="cc-chiprow" style={{ marginTop: 6 }}>
                <CategoryChip c={String(sel.category)} />
                <SeverityChip s={sel.severity} />
                <StatusChip s={sel.status} />
              </div>
              {sel.detail ? (
                <>
                  <div className="cc-notelabel">DETAIL</div>
                  <div className="cc-noteblock">{sel.detail}</div>
                </>
              ) : null}

              {sel.ruling ? (
                <div className="cc-comp-ruled">
                  <div className="cc-notelabel">RULING ON FILE</div>
                  <div className="cc-noteblock">{sel.ruling}</div>
                  <div className="who">
                    {sel.ruled_by || "—"} · {fmtDate(sel.ruled_at)}
                  </div>
                </div>
              ) : null}

              {/* ---- affected products ---- */}
              <div className="cc-panel-h" style={{ marginTop: 14 }}>
                <CcIcon name="products" />
                Affected Products
                <span className="right">
                  {sel.affectedCount == null ? "REGISTER-WIDE" : `${sel.affectedCount} LIVE MATCH${sel.affectedCount === 1 ? "" : "ES"}`}
                </span>
              </div>
              {sel.affectedCount == null ? (
                <span className="cc-empty">Not product-specific — this item covers the register, not a product set.</span>
              ) : sel.affected.length === 0 ? (
                <span className="cc-empty">No catalogue products currently match this pattern.</span>
              ) : (
                <>
                  <div className="cc-comp-affected">
                    {sel.affected.map((p) => (
                      <Link key={p.id} href={`/admin/product/${p.id}`} className="af">
                        <span className="nm">{p.name}</span>
                        {p.pillar ? <span className="cc-chip muted plain sm">{p.pillar.toUpperCase()}</span> : null}
                      </Link>
                    ))}
                  </div>
                  {sel.affectedCount > sel.affected.length ? (
                    <div className="cc-war-note">
                      {sel.affectedCount - sel.affected.length} more products match — first {sel.affected.length} shown.
                    </div>
                  ) : null}
                </>
              )}

              {/* ---- ruling form ---- */}
              <div className="cc-panel-h" style={{ marginTop: 14 }}>
                <CcIcon name="settings" />
                Land A Ruling
              </div>
              <div className="cc-map-edit">
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <label>
                    <span>Status</span>
                    <select
                      className="cc-input"
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value as ComplianceStatus)}
                    >
                      <option value="open">Open</option>
                      <option value="in_review">In review</option>
                      <option value="cleared">Cleared</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </label>
                  <label>
                    <span>Ruled by (required to save a ruling)</span>
                    <input
                      type="text"
                      className="cc-input"
                      placeholder="SC 08 — name"
                      value={ruledByDraft}
                      onChange={(e) => setRuledByDraft(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block">
                  <span>Ruling</span>
                  <textarea
                    className="cc-input"
                    rows={4}
                    placeholder="SC 08 decision — what is allowed, blocked, or required before this clears…"
                    value={rulingDraft}
                    onChange={(e) => setRulingDraft(e.target.value)}
                  />
                </label>
                <div className="foot">
                  <button type="button" className="cc-btn primary" onClick={saveRuling} disabled={saving}>
                    {saving ? "Saving…" : "Save Ruling"}
                  </button>
                  {msg ? <span className={`savemsg ${msg.ok ? "ok" : "err"}`}>{msg.text}</span> : null}
                </div>
              </div>
            </>
          ) : (
            <span className="cc-empty">Select a register item.</span>
          )}
        </div>

        {/* ---------- flagged products ---------- */}
        <div className="cc-panel cc-span12">
          <div className="cc-panel-h">
            <CcIcon name="products" />
            Flagged Products
            <span className="right">{flagged.length} FLAGGED · CLICK A HEADER TO SORT</span>
          </div>
          <div className="cc-notestrip">
            The product console hard-blocks approving any HOLD item — route to SC 08.
          </div>
          <div className="cc-tablewrap cc-comp-flagwrap">
            <table className="cc-table cc-comp-flagtable">
              <thead>
                <tr>
                  <FlagTh k="product">Product</FlagTh>
                  <th>Pillar</th>
                  <FlagTh k="severity">Flags</FlagTh>
                  <FlagTh k="status">Status</FlagTh>
                </tr>
              </thead>
              <tbody>
                {flagged.map((p) => (
                  <tr key={p.id} onClick={() => router.push(`/admin/product/${p.id}`)}>
                    <td>
                      <Link
                        href={`/admin/product/${p.id}`}
                        className="cc-comp-prodlink"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td>{p.pillar || "—"}</td>
                    <td>
                      <span className="cc-comp-flags">
                        {p.hold ? <span className="cc-chip red">HOLD</span> : null}
                        {p.dangerous_goods ? <span className="cc-chip red plain">DG</span> : null}
                        {p.safety_critical ? <span className="cc-chip amber plain">SAFETY</span> : null}
                        {p.ce_certified ? <span className="cc-chip green plain">CE</span> : null}
                      </span>
                    </td>
                    <td>
                      <span className="cc-chip muted plain sm">
                        {(p.product_status || "—").replace(/_/g, " ").toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
                {flagged.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <span className="cc-empty">No flagged products — no dangerous-goods, safety-critical or hold items.</span>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="cc-war-note">
            HOLD = the isComplianceHold rule (dangerous goods, or internal notes flagging COMPLIANCE / MEDICINE /
            POTASSIUM IODIDE) — the same rule the product console enforces at approval.
          </div>
        </div>

        {/* ---------- restrictions ---------- */}
        <div className="cc-panel cc-span6">
          <div className="cc-panel-h">
            <CcIcon name="map" />
            Restrictions
            <span className="right">
              {restrictions.shippingCount} SHIPPING · {restrictions.exportCount} EXPORT
            </span>
          </div>
          {restrictedTotal === 0 ? (
            <span className="cc-empty">No products carry shipping or export restrictions.</span>
          ) : (
            <>
              <div className="cc-comp-restrlist">
                {restrictions.list.map((p) => (
                  <Link key={p.id} href={`/admin/product/${p.id}`} className="rr">
                    <span className="nm">{p.name}</span>
                    <span className="tx" title={p.shipping || p.export || undefined}>
                      {p.shipping ? `SHIPPING — ${p.shipping}` : p.export ? `EXPORT — ${p.export}` : "—"}
                    </span>
                  </Link>
                ))}
              </div>
              {restrictedTotal > restrictions.list.length ? (
                <div className="cc-war-note">
                  {restrictedTotal - restrictions.list.length} more restricted products — first{" "}
                  {restrictions.list.length} shown.
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* ---------- AI safety (Jimmy) ---------- */}
        <div className="cc-panel cc-span6">
          <div className="cc-panel-h">
            <CcIcon name="jimmy" />
            AI Safety (Jimmy)
            <Link href="/admin/jimmy" className="right cc-comp-jimmylink">
              OPEN JIMMY CONSOLE →
            </Link>
          </div>
          <div className="cc-map-rows">
            <div className="row">
              <span className="k">SIGNED KNOWLEDGE</span>
              <span className={`v${jimmy.knowledgeSigned === jimmy.knowledgeTotal && jimmy.knowledgeTotal > 0 ? " green" : ""}`}>
                {jimmy.knowledgeSigned} / {jimmy.knowledgeTotal}
              </span>
            </div>
            <div className="row">
              <span className="k">PROMPT {jimmy.promptVersion ? `(${jimmy.promptVersion})` : ""}</span>
              <span className="v">
                {jimmy.promptStatus ? (
                  <span
                    className={`cc-chip plain sm ${String(jimmy.promptStatus).toUpperCase() === "SIGNED" ? "green" : "amber"}`}
                  >
                    {String(jimmy.promptStatus).toUpperCase()}
                  </span>
                ) : (
                  <span className="cc-chip muted plain sm">NOT FOUND</span>
                )}
              </span>
            </div>
            <div className="row">
              <span className="k">ACTIVE SAFETY TRIGGERS</span>
              <span className="v">{jimmy.triggersActive}</span>
            </div>
            <div className="row">
              <span className="k">CHALLENGE TESTS GRADED</span>
              <span className="v">{jimmy.evalGraded}</span>
            </div>
            <div className="row">
              <span className="k">CHALLENGE PASS RATE</span>
              <span className={`v${jimmy.passRate != null && jimmy.passRate >= 90 ? " green" : ""}`}>
                {jimmy.passRate == null ? "—" : `${jimmy.passRate}% (${jimmy.evalPassed}/${jimmy.evalGraded})`}
              </span>
            </div>
          </div>
          <div className="cc-notestrip" style={{ marginTop: 12 }}>
            Customer Jimmy serves SIGNED content only — sign-off pass pending (register item)
          </div>
        </div>
      </div>
    </main>
  );
}
