import { getCatalogue } from "@/lib/data";
import CatalogueBrowser from "./catalogue-browser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminHome() {
  let products: any[] | null = null;
  let err: string | null = null;
  try {
    products = await getCatalogue();
  } catch (e: any) {
    err = e?.message || "Failed to load data.";
  }

  if (products === null && !err) {
    return (
      <main className="container">
        <h2 className="pagetitle">Catalogue</h2>
        <div className="notice">
          The data source isn&apos;t configured yet. Set <code>SUPABASE_URL</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> in the Vercel project environment, then redeploy and this
          view will read live from Supabase.
        </div>
      </main>
    );
  }

  if (err) {
    return (
      <main className="container">
        <h2 className="pagetitle">Catalogue</h2>
        <div className="notice">Could not load the catalogue: {err}</div>
      </main>
    );
  }

  return (
    <main className="container">
      <h2 className="pagetitle">Product catalogue</h2>
      <CatalogueBrowser products={products || []} />
    </main>
  );
}
