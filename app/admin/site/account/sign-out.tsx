"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="sf-bkghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/shop/auth", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "logout" }),
          });
        } catch {
          /* signing out locally is still the right outcome */
        }
        router.push("/admin/site/account");
        router.refresh();
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
