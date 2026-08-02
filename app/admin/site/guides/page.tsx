import { supabaseAdmin } from "@/lib/supabase";
import KnowledgeHub from "./knowledge-hub";
import type { GuideRow } from "./pillar-meta";

export const dynamic = "force-dynamic";

// STOREFRONT PREVIEW — Guides / Knowledge Hub.
// Server component: fetches the guide drafts once, hands them to the
// client hub (pillar / category / search filtering happens client-side).
export default async function StorefrontGuidesPage() {
  let guides: GuideRow[] = [];
  let notice: string | null = null;

  const sb = supabaseAdmin();
  if (!sb) {
    notice =
      "Guides are offline — Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).";
  } else {
    const { data, error } = await sb
      .from("guides")
      .select("slug,title,pillar,category,featured,read_min,summary,status")
      .order("featured", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) {
      notice = `Guides failed to load: ${error.message}`;
    } else {
      guides = (data || []) as GuideRow[];
    }
  }

  return <KnowledgeHub guides={guides} notice={notice} />;
}
