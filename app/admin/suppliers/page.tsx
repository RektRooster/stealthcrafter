import { getEuMapData } from "@/lib/eu-map";
import { getSuppliersConsole } from "@/lib/suppliers-data";
import SuppliersConsole from "./suppliers-console";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const map = getEuMapData();
  let data = null;
  let loadError: string | null = null;
  try {
    data = await getSuppliersConsole();
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (!data) {
    return (
      <main className="cc-container">
        <div className="cc-notice">
          <strong>Supplier Intelligence is offline.</strong>{" "}
          {loadError
            ? `Data load failed: ${loadError}`
            : "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."}
        </div>
      </main>
    );
  }

  return <SuppliersConsole map={map} data={data} />;
}
