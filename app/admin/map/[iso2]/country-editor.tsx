"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CountryMarket } from "@/lib/map-data";

export default function CountryEditor({ market }: { market: CountryMarket }) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(market.market_status);
  const [readiness, setReadiness] = useState<string>(
    market.market_readiness === null ? "" : String(market.market_readiness)
  );
  const [priority, setPriority] = useState<boolean>(Boolean(market.priority));
  const [complianceNotes, setComplianceNotes] = useState<string>(market.compliance_notes || "");
  const [shippingNotes, setShippingNotes] = useState<string>(market.shipping_notes || "");
  const [notes, setNotes] = useState<string>(market.notes || "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/country/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          iso2: market.iso2,
          patch: {
            market_status: status,
            market_readiness: readiness.trim() === "" ? null : Number(readiness),
            priority,
            compliance_notes: complianceNotes.trim() || null,
            shipping_notes: shippingNotes.trim() || null,
            notes: notes.trim() || null,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `save failed (${res.status})`);
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Save failed." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cc-map-edit">
      <div className="grid">
        <label>
          <span>Market status</span>
          <select className="cc-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="researching">Researching</option>
            <option value="supplier_ready">Supplier ready</option>
            <option value="active">Active</option>
            <option value="compliance_hold">Compliance hold</option>
          </select>
        </label>
        <label>
          <span>Market readiness % (blank = not assessed)</span>
          <input
            className="cc-input"
            type="number"
            min={0}
            max={100}
            placeholder="Not assessed"
            value={readiness}
            onChange={(e) => setReadiness(e.target.value)}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} />
          <span>Priority expansion market</span>
        </label>
      </div>
      <label className="block">
        <span>Compliance notes</span>
        <textarea
          className="cc-input"
          rows={3}
          placeholder="No compliance review recorded yet"
          value={complianceNotes}
          onChange={(e) => setComplianceNotes(e.target.value)}
        />
      </label>
      <label className="block">
        <span>Shipping notes</span>
        <textarea
          className="cc-input"
          rows={2}
          placeholder="e.g. Fulfilment node (planned)"
          value={shippingNotes}
          onChange={(e) => setShippingNotes(e.target.value)}
        />
      </label>
      <label className="block">
        <span>Market notes / insights</span>
        <textarea
          className="cc-input"
          rows={3}
          placeholder="Market insights, distribution notes, localisation…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="foot">
        <button type="button" className="cc-btn primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save Market"}
        </button>
        {msg ? <span className={`savemsg ${msg.ok ? "ok" : "err"}`}>{msg.text}</span> : null}
      </div>
    </div>
  );
}
