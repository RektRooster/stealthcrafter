// Live figures and content for the storefront homepage.
//
// Count-only queries. Every number is read from Supabase at request time; a
// figure that is genuinely zero is suppressed rather than dressed up, and a
// table that cannot be read returns null so the surface can say so.
import { supabaseAdmin } from "./supabase";

export type HomeStat = { label: string; value: number; note: string };

export type HomeGuide = {
  slug: string;
  title: string;
  pillar: string | null;
  category: string;
  read_min: number;
  summary: string;
};

export type HomeData = {
  configured: boolean;
  stats: HomeStat[];
  guides: HomeGuide[];
  guidesSigned: number;
  guidesTotal: number;
};

async function count(sb: any, table: string, filter?: (q: any) => any): Promise<number | null> {
  try {
    let q = sb.from(table).select("id", { head: true, count: "exact" });
    if (filter) q = filter(q);
    const { count: c, error } = await q;
    if (error) return null;
    return typeof c === "number" ? c : null;
  } catch {
    return null;
  }
}

export async function getHomeData(): Promise<HomeData> {
  const sb = supabaseAdmin();
  if (!sb) return { configured: false, stats: [], guides: [], guidesSigned: 0, guidesTotal: 0 };

  const [products, countries, suppliers, guidesTotal, guidesSigned, knowledgeSigned] = await Promise.all([
    count(sb, "products"),
    count(sb, "country_markets"),
    count(sb, "suppliers"),
    count(sb, "guides"),
    count(sb, "guides", (q: any) => q.eq("status", "SIGNED")),
    count(sb, "jimmy_knowledge", (q: any) => q.eq("status", "SIGNED")),
  ]);

  // SIGNED-only, same gate the Knowledge Hub uses. Customer surfaces never
  // serve unreviewed content.
  let guides: HomeGuide[] = [];
  try {
    const { data } = await sb
      .from("guides")
      .select("slug,title,pillar,category,read_min,summary")
      .eq("status", "SIGNED")
      .order("featured", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(3);
    guides = (data || []) as HomeGuide[];
  } catch {
    guides = [];
  }

  const raw: HomeStat[] = [
    { label: "Products assessed", value: products ?? 0, note: "in the catalogue under review" },
    { label: "European markets mapped", value: countries ?? 0, note: "EU-27 supply and regulatory profiles" },
    { label: "Suppliers in the network", value: suppliers ?? 0, note: "sourcing routes traced to origin" },
    { label: "Guides reviewed and signed", value: guidesSigned ?? 0, note: "published only after safety sign-off" },
    { label: "Knowledge entries signed", value: knowledgeSigned ?? 0, note: "the grounded set Jimmy answers from" },
  ];

  return {
    configured: true,
    // A zero is not a milestone. Anything still at zero is left off the page.
    stats: raw.filter((s) => s.value > 0),
    guides,
    guidesSigned: guidesSigned ?? 0,
    guidesTotal: guidesTotal ?? 0,
  };
}
