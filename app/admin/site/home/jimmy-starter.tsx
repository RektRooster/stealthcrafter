"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The homepage's single next step. Rather than a button that dumps the visitor
// on an empty chat, the first question is asked here and carried into the
// conversation — the journey starts on the homepage and is never restarted.
const SUGGESTIONS = [
  "We lose power a few times each winter — where should I start?",
  "I have two kids under five. What does that change?",
  "How much water should a household actually store?",
  "What do I do first if the tap water is not safe?",
];

export default function JimmyStarter() {
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
    <div className="sf-start">
      <form
        className="sf-startrow"
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
      >
        <input
          className="sf-startinput"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tell Jimmy about your household, or ask anything…"
          aria-label="Ask Jimmy"
        />
        <button type="submit" className="sf-startbtn" disabled={going}>
          {going ? "Opening…" : q.trim() ? "Ask Jimmy" : "Start with Jimmy"}
        </button>
      </form>
      <div className="sf-startnote">
        Around five minutes. Jimmy asks about your household before recommending anything —
        and answers only from material that has been reviewed and signed off.
      </div>
      <div className="sf-startsugg">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => go(s)} className="sf-suggchip">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
