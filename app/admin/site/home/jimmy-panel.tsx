"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const PROMPTS = [
  "We lose power a few times each winter",
  "I have two kids under five",
  "How much water should we store?",
  "The tap water is not safe — what now?",
];

/* Jimmy lives in the sidebar: always there, never in the way. */
export default function JimmyPanel({ stats }: { stats: { label: string; value: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [going, setGoing] = useState(false);

  function go(text: string) {
    const msg = text.trim();
    if (!msg) return;
    setGoing(true);
    router.push(`/admin/site/jimmy?q=${encodeURIComponent(msg)}`);
  }

  return (
    <aside className="sf-jp">
      <div className="sf-jp-card">
        <div className="sf-jp-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="46" height="46">
            <defs>
              <linearGradient id="jpg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#e3cf9f" />
                <stop offset="100%" stopColor="#b18f4e" />
              </linearGradient>
            </defs>
            <path
              d="M24 3 L42 13.5 V34.5 L24 45 L6 34.5 V13.5 Z"
              fill="none"
              stroke="url(#jpg)"
              strokeWidth="2"
            />
            <path
              d="M24 12 L33.5 17.5 V28.5 L24 34 L14.5 28.5 V17.5 Z"
              fill="url(#jpg)"
              opacity=".9"
            />
          </svg>
        </div>
        <h2>Protect the people you love.</h2>
        <p>
          Jimmy learns how your household actually lives, then builds the preparedness system that
          fits it. Around five minutes.
        </p>

        <form
          className="sf-jp-form"
          onSubmit={(e) => {
            e.preventDefault();
            go(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask Jimmy anything…"
            aria-label="Ask Jimmy"
          />
          <button type="submit" disabled={going}>
            {going ? "Opening…" : q.trim() ? "Ask" : "Start"}
          </button>
        </form>

        <div className="sf-jp-prompts">
          {PROMPTS.map((p) => (
            <button key={p} type="button" onClick={() => go(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="sf-jp-stats">
        {stats.map((s) => (
          <div key={s.label}>
            <strong>{s.value}</strong>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
