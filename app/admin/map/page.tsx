import { getEuMapData } from "@/lib/eu-map";
import { getCountryMarkets, getSupplyStats } from "@/lib/map-data";
import MapConsole from "./map-console";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const map = getEuMapData();
  let markets = null;
  let stats = null;
  let loadError: string | null = null;
  try {
    [markets, stats] = await Promise.all([getCountryMarkets(), getSupplyStats()]);
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (!markets || !stats) {
    return (
      <main className="cc-container">
        <div className="cc-notice">
          <strong>EU Map is offline.</strong>{" "}
          {loadError
            ? `Data load failed: ${loadError}`
            : "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."}
        </div>
      </main>
    );
  }

  return <MapConsole map={map} markets={markets} stats={stats} />;
}
