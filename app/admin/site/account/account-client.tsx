"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "signin" | "signup" | "reset";

export default function AccountClient({ nextHref }: { nextHref: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signup");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [f, setF] = useState({ name: "", email: "", password: "", newPassword: "" });

  function set(k: keyof typeof f, v: string) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setNote("");
    try {
      const action = mode === "signin" ? "login" : mode === "signup" ? "signup" : "reset";
      const r = await fetch("/api/shop/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...f }),
      });
      const b = await r.json();
      if (!b?.ok) {
        setErr(b?.error || "That did not work. Please try again.");
        return;
      }
      if (mode === "reset") {
        setNote("Password changed. You can sign in with it now.");
        setMode("signin");
        return;
      }
      router.push(nextHref);
      router.refresh();
    } catch {
      setErr("We could not reach the accounts service just now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sf-acauth">
      <div className="sf-actabs" role="tablist">
        <button type="button" className={mode === "signup" ? "on" : ""} onClick={() => setMode("signup")}>
          Create an account
        </button>
        <button type="button" className={mode === "signin" ? "on" : ""} onClick={() => setMode("signin")}>
          Sign in
        </button>
        <button type="button" className={mode === "reset" ? "on" : ""} onClick={() => setMode("reset")}>
          Forgotten password
        </button>
      </div>

      <form onSubmit={submit}>
        {mode === "signup" ? (
          <>
            <p className="sf-aclede">
              An account keeps your household profile, the kit you already own, and your order
              history in one place — which is what lets Jimmy give advice about your household
              rather than a generic one.
            </p>
            <label className="sf-cofield">
              <span>Your name</span>
              <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ace" />
            </label>
          </>
        ) : null}

        <label className="sf-cofield">
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </label>

        {mode !== "reset" ? (
          <label className="sf-cofield">
            <span>Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={f.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </label>
        ) : (
          <>
            <div className="sf-codemo">
              <strong>Demo shortcut.</strong> There is no transactional email connected yet, so there
              is no reset link to send. Rather than a reset flow that silently does nothing, this
              sets a new password directly. It is only safe because the whole site sits behind the
              founder password gate and holds fictional data — and it gets replaced by a real email
              link before launch.
            </div>
            <label className="sf-cofield">
              <span>New password</span>
              <input
                type="password"
                required
                minLength={8}
                value={f.newPassword}
                onChange={(e) => set("newPassword", e.target.value)}
              />
            </label>
          </>
        )}

        {err ? <div className="sf-coerr">{err}</div> : null}
        {note ? <div className="sf-acnote">{note}</div> : null}

        <button className="sf-cta full" type="submit" disabled={busy}>
          {busy
            ? "Working…"
            : mode === "signup"
            ? "Create my account"
            : mode === "signin"
            ? "Sign in"
            : "Set a new password"}
        </button>
      </form>

      <p className="sf-conote">
        Demo environment — please use a fictional name and an address you are happy to see on screen.
        No real personal data until the legal wrapper exists.
      </p>
    </div>
  );
}
