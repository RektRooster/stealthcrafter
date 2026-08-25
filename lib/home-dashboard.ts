// CUSTOMER HOME — the dashboard.
//
// One page, app-like: live European conditions at the centre, Jimmy in the
// sidebar, knowledge and tested equipment below. Everything here is real data
// from the live tables; the page presents the finished product rather than
// narrating what is still being built.
import { supabaseAdmin } from "./supabase";
import { parseImages } from "./catalogue-data";

export type DashGuide = {
  slug: string;
  title: string;
  pillar: string | null;
  category: string;
  readMin: number;
  summary: string;
  featured: boolean;
};

export type DashTested = {
  code: string;
  product: string;
  brand: string | null;
  category: string;
  image: string | null;
  passed: number;
  total: number;
  when: string | null;
};

export type DashProduct = {
  slug: string;
  name: string;
  brand: string | null;
  category: string;
  image: string | null;
  price: number | null;
};

export type DashStats = {
  products: number;
  markets: number;
  suppliers: number;
  guides: number;
  tested: number;
  checkpoints: number;
};

export type HomeDashboard = {
  configured: boolean;
  guides: DashGuide[];
  tested: DashTested[];
  heroes: DashProduct[];
  stats: DashStats;
};

async function countOf(sb: any, table: string, filter?: (q: any) => any): Promise<number> {
  try {
    let q = sb.from(table).select("id", { head: true, count: "exact" });
    if (filter) q = filter(q);
    const { count } = await q;
    return typeof count === "number" ? count : 0;
  } catch {
    return 0;
  }
}

export async function getHomeDashboard(): Promise<HomeDashboard> {
  const sb = supabaseAdmin();
  const empty: HomeDashboard = {
    configured: false,
    guides: [],
    tested: [],
    heroes: [],
    stats: { products: 0, markets: 0, suppliers: 0, guides: 0, tested: 0, checkpoints: 0 },
  };
  if (!sb) return empty;

  const [products, markets, suppliers, guidesCount, checkpoints] = await Promise.all([
    countOf(sb, "products"),
    countOf(sb, "country_markets"),
    countOf(sb, "suppliers"),
    countOf(sb, "guides"),
    countOf(sb, "test_checkpoints"),
  ]);

  /* ---- knowledge ---- */
  let guides: DashGuide[] = [];
  try {
    const { data } = await sb
      .from("guides")
      .select("slug,title,pillar,category,read_min,summary,featured")
      .order("featured", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(6);
    guides = ((data as any[]) || []).map((g) => ({
      slug: g.slug,
      title: g.title,
      pillar: g.pillar ?? null,
      category: g.category,
      readMin: g.read_min ?? 5,
      summary: g.summary ?? "",
      featured: Boolean(g.featured),
    }));
  } catch {
    guides = [];
  }

  /* ---- tested equipment ---- */
  let tested: DashTested[] = [];
  try {
    const { data: sessions } = await sb
      .from("test_sessions")
      .select("id,test_code,product_id,completed_at")
      .eq("published", true)
      .eq("status", "completed")
      .neq("verdict", "fail")
      .order("completed_at", { ascending: false })
      .limit(6);
    const list: any[] = (sessions as any[]) || [];
    if (list.length) {
      const ids = list.map((s) => s.product_id).filter(Boolean);
      const { data: prods } = await sb
        .from("products")
        .select("id,sc_product_name,product_name,brand,category_id,image_urls")
        .in("id", ids);
      const { data: catRows } = await sb.from("categories").select("id,name");
      const cats: Record<number, string> = {};
      (catRows || []).forEach((c: any) => (cats[c.id] = c.name));
      const pmap: Record<string, any> = {};
      (prods || []).forEach((p: any) => (pmap[p.id] = p));

      const { data: cps } = await sb
        .from("test_checkpoints")
        .select("session_id,result")
        .in("session_id", list.map((s) => s.id));
      const byS: Record<string, any[]> = {};
      ((cps as any[]) || []).forEach((c) => (byS[c.session_id] ||= []).push(c));

      tested = list.map((s) => {
        const p = pmap[s.product_id] || {};
        const rows = byS[s.id] || [];
        return {
          code: s.test_code,
          product: p.sc_product_name || p.product_name || "Product",
          brand: p.brand ?? null,
          category: cats[p.category_id] || "",
          image: parseImages(p.image_urls)[0] ?? null,
          passed: rows.filter((r) => r.result === "pass").length,
          total: rows.length,
          when: s.completed_at ?? null,
        };
      });
    }
  } catch {
    tested = [];
  }

  /* ---- hero equipment ---- */
  let heroes: DashProduct[] = [];
  try {
    const { data } = await sb
      .from("products")
      .select("slug,sc_product_name,product_name,brand,category_id,image_urls,selling_price,currency")
      .eq("hero_product", true)
      .not("image_urls", "is", null)
      .limit(24);
    const { data: catRows } = await sb.from("categories").select("id,name");
    const cats: Record<number, string> = {};
    (catRows || []).forEach((c: any) => (cats[c.id] = c.name));
    heroes = ((data as any[]) || [])
      .map((p) => {
        const raw = p.selling_price === null ? null : Number(p.selling_price);
        return {
          slug: p.slug,
          name: p.sc_product_name || p.product_name || "Product",
          brand: p.brand ?? null,
          category: cats[p.category_id] || "",
          image: parseImages(p.image_urls)[0] ?? null,
          price:
            raw === null
              ? null
              : (p.currency || "EUR").toUpperCase() === "GBP"
              ? Math.round(raw * 1.17 * 100) / 100
              : raw,
        };
      })
      .filter((p) => p.slug && p.image)
      .slice(0, 6);
  } catch {
    heroes = [];
  }

  return {
    configured: true,
    guides,
    tested,
    heroes,
    stats: {
      products,
      markets,
      suppliers,
      guides: guidesCount,
      tested: tested.length,
      checkpoints,
    },
  };
}
