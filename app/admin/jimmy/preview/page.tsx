import { getJimmyPreviewData } from "@/lib/jimmy/preview-data";
import JimmyPreview from "./jimmy-preview";

export const dynamic = "force-dynamic";

// Page B — Jimmy Customer Experience Preview.
// Lives INSIDE the admin shell and inherits the /admin middleware gate.
// Everything shown is what a customer would see, minus the preview banner.
export default async function JimmyPreviewPage() {
  let data = null;
  let loadError: string | null = null;
  try {
    data = await getJimmyPreviewData();
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (!data || !data.configured) {
    return (
      <main className="cc-container">
        <div className="cc-notice">
          <strong>Customer preview is offline.</strong>{" "}
          {loadError
            ? `Data load failed: ${loadError}`
            : "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."}
        </div>
      </main>
    );
  }

  return <JimmyPreview data={data} />;
}
