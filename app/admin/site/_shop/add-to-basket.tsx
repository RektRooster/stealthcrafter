"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/* The primary action on a product page. It really works now — and it says so
   when it cannot, rather than sitting greyed out with no explanation. */
export default function AddToBasket({
  productId,
  buyable,
  reason,
}: {
  productId: string;
  buyable: boolean;
  reason?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function add() {
    setState("busy");
    setMsg("");
    try {
      const r = await fetch("/api/shop/basket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add", ref: productId, qty: 1 }),
      });
      const b = await r.json();
      if (b?.ok) {
        setState("done");
        setMsg(b.message || "Added to your basket.");
        router.refresh(); // the header count is server-rendered
        setTimeout(() => setState("idle"), 2600);
      } else {
        setState("error");
        setMsg(b?.message || "We could not add that just now.");
      }
    } catch {
      setState("error");
      setMsg("We could not reach the basket just now. Nothing has been lost.");
    }
  }

  if (!buyable) {
    return (
      <div className="sf-atb">
        <button type="button" className="sf-cta sm off" disabled>
          Not yet available
        </button>
        {reason ? <span className="sf-atbnote">{reason}</span> : null}
      </div>
    );
  }

  return (
    <div className="sf-atb">
      <button type="button" className="sf-cta sm" onClick={add} disabled={state === "busy"}>
        {state === "busy" ? "Adding…" : state === "done" ? "In your basket ✓" : "Add to basket"}
      </button>
      {msg ? <span className={`sf-atbnote${state === "error" ? " bad" : ""}`}>{msg}</span> : null}
    </div>
  );
}
