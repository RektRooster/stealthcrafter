import { getCatalogueData } from "@/lib/catalogue-data";
import CatalogueBrowser from "./catalogue-browser";

export const dynamic = "force-dynamic";

// STOREFRONT PREVIEW — Catalogue.
// Conventional store browse (19 categories, filters, sort, prices) sitting on
// top of an evidence ledger: every product shows what we have actually
// verified and what we have not. Behind the /admin gate.
export default async function StorefrontCataloguePage() {
  const data = await getCatalogueData();

  if (!data.configured) {
    return (
      <main className="sf-page">
        <div className="sf-inner">
          <div className="cc-notice">
            <strong>Catalogue is offline.</strong> Supabase is not configured — set SUPABASE_URL and
            SUPABASE_SERVICE_ROLE_KEY.
          </div>
        </div>
      </main>
    );
  }

  return <CatalogueBrowser data={data} />;
}
