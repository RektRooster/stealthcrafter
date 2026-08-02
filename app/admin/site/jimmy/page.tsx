import { getJimmyPreviewData } from "@/lib/jimmy/preview-data";
import JimmyPreview from "./jimmy-preview";

export const dynamic = "force-dynamic";

// STOREFRONT PREVIEW — the customer Jimmy experience (re-homed from
// /admin/jimmy/preview, which now redirects here).
// Lives INSIDE the admin shell and inherits the /admin middleware gate.
// Everything shown is what a customer would see, minus the preview banner.
export default async function StorefrontJimmyPage() {
  let data = null;
  let loadError: string | null = null;
  try {
    data = await getJimmyPreviewData();
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (!data || !data.configured) {
    return (
      <main className="sf-embed">
        <div className="cc-container">
          <div className="cc-notice">
            <strong>Customer preview is offline.</strong>{" "}
            {loadError
              ? `Data load failed: ${loadError}`
              : "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="sf-embed">
      <JimmyPreview data={data} />
    </div>
  );
}
