import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { PillarIcon, MiniIcon, guideChip, type GuideRow } from "../pillar-meta";

export const dynamic = "force-dynamic";

// STOREFRONT PREVIEW — guide detail. Renders body_md with a tiny built-in
// markdown renderer (## / ###, paragraphs, - lists, *em* / **strong**, ---).
// No markdown dependency; content is our own seeded drafts.

type FullGuide = GuideRow & { body_md: string; sources: string | null };

/* ---------- tiny markdown renderer ---------- */

function inline(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((s) => s !== "");
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={`${keyBase}-${i}`}>{part.slice(1, -1)}</em>;
    }
    return <span key={`${keyBase}-${i}`}>{part}</span>;
  });
}

function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let k = 0;

  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ").trim();
      if (text) out.push(<p key={`p${k++}`}>{inline(text, `p${k}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      out.push(
        <ul key={`u${k++}`}>
          {list.map((item, i) => (
            <li key={i}>{inline(item, `l${k}-${i}`)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("### ")) {
      flushPara();
      flushList();
      out.push(<h3 key={`h${k++}`}>{inline(line.slice(4), `h${k}`)}</h3>);
    } else if (line.startsWith("## ")) {
      flushPara();
      flushList();
      out.push(<h2 key={`h${k++}`}>{inline(line.slice(3), `h${k}`)}</h2>);
    } else if (/^---+\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push(<hr key={`r${k++}`} />);
    } else if (line.startsWith("- ")) {
      flushPara();
      list.push(line.slice(2));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out;
}

/* ---------- page ---------- */

export default async function GuideDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sb = supabaseAdmin();
  if (!sb) {
    return (
      <main className="sf-page sf-kh">
        <div className="sf-kh-article">
          <div className="sf-kh-notice">
            Guides are offline — Supabase is not configured.
          </div>
        </div>
      </main>
    );
  }

  const { data, error } = await sb
    .from("guides")
    .select("slug,title,pillar,category,featured,read_min,summary,status,body_md,sources")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) notFound();
  const g = data as FullGuide;
  const chip = guideChip(g);
  const catLabel =
    g.category === "scenario"
      ? "Scenario guide"
      : g.category === "beginner"
        ? "Beginner guide"
        : g.category.charAt(0).toUpperCase() + g.category.slice(1);

  return (
    <main className="sf-page sf-kh">
      <article className="sf-kh-article">
        <Link href="/admin/site/guides" className="sf-kh-back">
          <MiniIcon name="arrow" size={14} /> Knowledge Hub
        </Link>

        <div className={`sf-kh-artkicker ${chip.cls}`}>
          <span className="chip">
            {chip.icon ? (
              <MiniIcon name={chip.icon} size={12} />
            ) : (
              <PillarIcon pillar={g.pillar} size={12} />
            )}
            {chip.label}
          </span>
          <span className="dot">·</span>
          <span>{catLabel}</span>
          <span className="dot">·</span>
          <span className="read">
            <MiniIcon name="clock" size={12} /> {g.read_min} min read
          </span>
        </div>

        <h1 className="sf-kh-arttitle">{g.title}</h1>
        <p className="sf-kh-artsummary">{g.summary}</p>
        <div className="sf-kh-heroline" />

        <div className="sf-kh-prose">{renderMarkdown(g.body_md)}</div>

        {g.sources ? (
          <div className="sf-kh-sources">
            <strong>Sources:</strong> {g.sources}
          </div>
        ) : null}

        <div className="sf-kh-artactions">
          <Link href="/admin/site/jimmy" className="sf-kh-btn primary">
            <MiniIcon name="chat" size={15} /> Ask Jimmy about this
          </Link>
          <Link href="/admin/site/guides" className="sf-kh-btn ghost">
            All guides
          </Link>
        </div>

      </article>
    </main>
  );
}
