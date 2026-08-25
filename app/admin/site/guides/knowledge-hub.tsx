"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  GuideRow,
  PILLARS,
  PillarKey,
  PillarIcon,
  MiniIcon,
  guideChip,
} from "./pillar-meta";

// STOREFRONT PREVIEW — Knowledge Hub ("KNOWLEDGE BEFORE COMMERCE").
// Client component: pillar cards + category tabs + search filter the grid.
// No photographic imagery; gradients + inline SVG only (art pending SC 09).

const TABS: { key: string; label: string }[] = [
  { key: "featured", label: "Featured Guides" },
  { key: "essentials", label: "Essentials" },
  { key: "scenario", label: "Scenario Guides" },
  { key: "beginner", label: "Beginner Guides" },
  { key: "technical", label: "Technical" },
  { key: "all", label: "All Guides" },
];

const TRUST = [
  { icon: "shield", a: "Trusted", b: "Expert Knowledge" },
  { icon: "scales", a: "Independent", b: "and Unbiased" },
  { icon: "compass", a: "Always Practical", b: "and Actionable" },
];

const VALUES = [
  { icon: "book", a: "Clear, step-by-step guidance", b: "From basics to advanced" },
  { icon: "shield", a: "Independent and unbiased", b: "No fear, no hype — just facts" },
  { icon: "home", a: "Focused on real life", b: "For you, your family and your home" },
  { icon: "compass", a: "Actionable knowledge", b: "Turn information into preparedness" },
];

function JimmyMark() {
  // The stylised SC hexagon Jimmy — same mark language as the Jimmy console.
  // Deliberately NOT a real-person likeness (pending SC 09 / legal).
  return (
    <svg viewBox="0 0 120 120" width="64" height="64" className="sf-kh-jimmy-mark" aria-hidden="true">
      <circle cx="60" cy="60" r="56" className="halo" />
      <path d="M60 16 L97.5 37.5 V82.5 L60 104 L22.5 82.5 V37.5 Z" className="hex" />
      <path d="M60 32 L83.5 45.5 V72.5 L60 86 L36.5 72.5 V45.5 Z" className="hexin" />
      <circle cx="49.5" cy="56" r="3.6" className="eye" />
      <circle cx="70.5" cy="56" r="3.6" className="eye" />
      <path d="M47 68 Q60 78 73 68" className="mouth" />
    </svg>
  );
}

export default function KnowledgeHub({
  guides,
  notice,
}: {
  guides: GuideRow[];
  notice?: string | null;
}) {
  const [pillar, setPillar] = useState<PillarKey | null>(null);
  const [tab, setTab] = useState("featured");
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    let list = guides;
    if (tab === "featured") list = list.filter((g) => g.featured);
    else if (tab !== "all") list = list.filter((g) => g.category === tab);
    if (pillar) {
      list =
        pillar === "beyond"
          ? list.filter((g) => !g.pillar)
          : list.filter((g) => g.pillar === pillar);
    }
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(needle) ||
          g.summary.toLowerCase().includes(needle)
      );
    }
    return list;
  }, [guides, pillar, tab, q]);

  function togglePillar(key: PillarKey) {
    if (pillar === key) {
      setPillar(null);
    } else {
      setPillar(key);
      setTab("all"); // show everything for that pillar
    }
  }

  return (
    <main className="sf-page sf-kh">
      <div className="sf-kh-inner">
        {/* ---------- hero + Jimmy panel ---------- */}
        <section className="sf-kh-top">
          <div className="sf-kh-hero">
            <div className="sf-kh-kicker">Knowledge Hub</div>
            <h1>
              Knowledge <em>before</em> commerce
            </h1>
            <p className="sf-kh-sub">
              Clear, practical, expert knowledge to help you protect the people
              you love and make better preparedness decisions.
            </p>
            <div className="sf-kh-heroline" />
            <div className="sf-kh-trust">
              {TRUST.map((t) => (
                <div className="sf-kh-trustitem" key={t.a}>
                  <span className="ic">
                    <MiniIcon name={t.icon} size={20} />
                  </span>
                  <span>
                    <strong>{t.a}</strong>
                    {t.b}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <aside className="sf-kh-jimmy">
            <div className="sf-kh-jimmy-head">
              <span>Meet Jimmy — your preparedness companion</span>
              <span className="sf-kh-online">
                <i /> Online
              </span>
            </div>
            <div className="sf-kh-jimmy-body">
              <JimmyMark />
              <div>
                <h3>Not sure where to start?</h3>
                <p>
                  Ask Jimmy for guidance, or explore the guides below to build
                  your knowledge with confidence.
                </p>
              </div>
            </div>
            <div className="sf-kh-jimmy-actions">
              <Link href="/admin/site/jimmy" className="sf-kh-btn primary">
                <MiniIcon name="chat" size={15} /> Chat with Jimmy
              </Link>
              <Link href="/admin/site/jimmy" className="sf-kh-btn ghost">
                Start assessment <MiniIcon name="arrow" size={15} />
              </Link>
            </div>
          </aside>
        </section>

        {notice ? <div className="sf-kh-notice">{notice}</div> : null}

        {/* ---------- six pillar cards ---------- */}
        <section className="sf-kh-pillars" aria-label="Preparedness pillars">
          {PILLARS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`sf-kh-pillar ${p.cls}${pillar === p.key ? " active" : ""}`}
              onClick={() => togglePillar(p.key)}
              aria-pressed={pillar === p.key}
            >
              <span className="glow" aria-hidden="true" />
              <span className="ic">
                <PillarIcon pillar={p.key === "beyond" ? null : p.key} size={30} />
              </span>
              <span className="nm">{p.label}</span>
              <span className="ds">{p.desc}</span>
              <span className="arr" aria-hidden="true">
                <MiniIcon name="arrow" size={15} />
              </span>
            </button>
          ))}
        </section>

        {/* ---------- category tabs + search ---------- */}
        <div className="sf-kh-tabsrow">
          <div className="sf-kh-tabs" role="tablist" aria-label="Guide categories">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`sf-kh-tab${tab === t.key ? " active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="sf-kh-search"
            placeholder="Search knowledge…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search guides"
          />
        </div>

        {/* ---------- guide cards ---------- */}
        {shown.length > 0 ? (
          <section className="sf-kh-grid">
            {shown.map((g) => {
              const chip = guideChip(g);
              return (
                <Link
                  key={g.slug}
                  href={`/admin/site/guides/${g.slug}`}
                  className={`sf-kh-card ${chip.cls}`}
                >
                  <div className="band" aria-hidden="true">
                    <span className="bandic">
                      <PillarIcon pillar={g.pillar} size={34} />
                    </span>
                    <span className="chip">
                      {chip.icon ? (
                        <MiniIcon name={chip.icon} size={12} />
                      ) : (
                        <PillarIcon pillar={g.pillar} size={12} />
                      )}
                      {chip.label}
                    </span>
                    <span className="read">
                      <MiniIcon name="clock" size={12} /> {g.read_min} min read
                    </span>
                  </div>
                  <div className="body">
                    <h3>{g.title}</h3>
                    <p>{g.summary}</p>
                    <div className="foot">
                      <span />
                      <span className="go" aria-hidden="true">
                        <MiniIcon name="arrow" size={16} />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </section>
        ) : (
          <div className="sf-kh-empty">
            {tab === "technical" && !q
              ? "Technical deep-dives arrive with the Tested Reports programme."
              : "No guides match those filters yet."}
            {(pillar || q) && (
              <button
                type="button"
                className="sf-kh-clear"
                onClick={() => {
                  setPillar(null);
                  setQ("");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* ---------- value strip ---------- */}
        <section className="sf-kh-values">
          {VALUES.map((v) => (
            <div className="sf-kh-value" key={v.a}>
              <span className="ic">
                <MiniIcon name={v.icon} size={20} />
              </span>
              <span>
                <strong>{v.a}</strong>
                {v.b}
              </span>
            </div>
          ))}
        </section>

      </div>
    </main>
  );
}
