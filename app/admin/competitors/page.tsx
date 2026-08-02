import { getEuMapData } from "@/lib/eu-map";
import { getCountryMarkets } from "@/lib/map-data";
import { getCompetitors } from "@/lib/competitors-data";
import CompetitorsConsole from "./competitors-console";

export const dynamic = "force-dynamic";

export default async function CompetitorsPage() {
  const map = getEuMapData();
  let competitors = null;
  let markets = null;
  let loadError: string | null = null;
  try {
    [competitors, markets] = await Promise.all([getCompetitors(), getCountryMarkets()]);
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (!competitors || !markets) {
    return (
      <main className="cc-container">
        <div className="cc-notice">
          <strong>Competitor War Room is offline.</strong>{" "}
          {loadError
            ? `Data load failed: ${loadError}`
            : "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."}
        </div>
      </main>
    );
  }

  return <CompetitorsConsole map={map} competitors={competitors} markets={markets} />;
}
