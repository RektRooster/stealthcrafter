"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CcIcon } from "../cc-chrome";
import { NEXT_STATUS, STATUS_LABEL, type AdminOrderRow, type OrderStatus } from "@/lib/commerce/orders";
import { eur } from "@/lib/commerce/vat";

const PIPELINE: OrderStatus[] = ["placed", "paid", "picking", "shipped", "delivered"];

export default function OrdersConsole({ rows }: { rows: AdminOrderRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<OrderStatus | "all">("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const revenue = useMemo(
    () => rows.filter((r) => r.status !== "cancelled").reduce((a, r) => a + r.grandTotal, 0),
    [rows]
  );

  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  async function move(id: string, next: OrderStatus) {
    setBusy(id);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: id, status: next }),
      });
      const b = await r.json();
      setMsg({ ok: Boolean(b?.ok), text: b?.message || "Done." });
      if (b?.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "That status change did not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) {
    return (
      <div className="cc-panel">
        <div className="cc-panel-h">
          <CcIcon name="orders" />
          Orders &amp; Fulfilment
          <span className="right">NO ORDERS YET</span>
        </div>
        <div className="cc-notestrip">
          NO ORDERS YET — and none will be invented. Place one through the storefront
          (Catalogue → Add to basket → Checkout → demo payment) and it appears here within seconds.
          This console reads live order data only.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="cc-tiles">
        <div className="cc-tile">
          <div className="n">{rows.length}</div>
          <div className="l">Orders</div>
        </div>
        <div className="cc-tile">
          <div className="n">{eur(revenue)}</div>
          <div className="l">Demo order value</div>
        </div>
        <div className="cc-tile">
          <div className="n">{(counts.placed || 0) + (counts.paid || 0) + (counts.picking || 0)}</div>
          <div className="l">Open</div>
        </div>
        <div className="cc-tile">
          <div className="n">{counts.delivered || 0}</div>
          <div className="l">Delivered</div>
        </div>
      </div>

      <div className="cc-panel">
        <div className="cc-panel-h">
          <CcIcon name="orders" />
          Orders &amp; Fulfilment
          <span className="right">DEMO DATA — NO MONEY MOVED</span>
        </div>

        <div className="cc-ordfilters">
          <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            All ({rows.length})
          </button>
          {PIPELINE.concat(["cancelled", "returned"]).map((s) => (
            <button
              key={s}
              type="button"
              className={filter === s ? "on" : ""}
              onClick={() => setFilter(s)}
              disabled={!counts[s]}
            >
              {STATUS_LABEL[s]} ({counts[s] || 0})
            </button>
          ))}
        </div>

        {msg ? <div className={`cc-ordmsg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div> : null}

        <div className="cc-tablewrap">
          <table className="cc-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Placed</th>
                <th>Customer</th>
                <th>To</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
                <th>Advance</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => {
                const next = NEXT_STATUS[o.status];
                return (
                  <tr key={o.id}>
                    <td className="mono">
                      <Link href={`/admin/site/order/${o.reference}`}>{o.reference}</Link>
                    </td>
                    <td className="sm">{new Date(o.placedAt).toLocaleString("en-GB")}</td>
                    <td className="sm">
                      {o.customerName || <em>guest</em>}
                      <br />
                      <span className="cc-ordemail">{o.email}</span>
                    </td>
                    <td className="mono sm">{o.country || "—"}</td>
                    <td className="mono">{o.itemCount}</td>
                    <td className="mono">{eur(o.grandTotal)}</td>
                    <td>
                      <span className={`cc-chip s-${o.status}`}>{STATUS_LABEL[o.status]}</span>
                    </td>
                    <td>
                      {next.length === 0 ? (
                        <span className="cc-ordend">—</span>
                      ) : (
                        <div className="cc-ordmoves">
                          {next.map((n) => (
                            <button
                              key={n}
                              type="button"
                              className={`cc-btn sm${n === "cancelled" ? "" : " primary"}`}
                              disabled={busy === o.id}
                              onClick={() => move(o.id, n)}
                            >
                              {busy === o.id ? "…" : `Mark ${STATUS_LABEL[n].toLowerCase()}`}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="cc-notestrip" style={{ marginTop: 12 }}>
          Every move is written to the order's own history with a timestamp, so an order's life is
          readable after the fact rather than just its current state. Only legal moves are offered —
          a delivered order cannot go back to picking.
        </div>
      </div>
    </>
  );
}
