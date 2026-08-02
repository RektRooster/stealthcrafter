import { getComplianceConsole } from "@/lib/compliance-data";
import ComplianceConsole from "./compliance-console";

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  let data = null;
  let loadError: string | null = null;
  try {
    data = await getComplianceConsole();
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (!data) {
    return (
      <main className="cc-container">
        <div className="cc-notice">
          <strong>Compliance console is offline.</strong>{" "}
          {loadError
            ? `Data load failed: ${loadError}`
            : "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."}
        </div>
      </main>
    );
  }

  return <ComplianceConsole data={data} />;
}
