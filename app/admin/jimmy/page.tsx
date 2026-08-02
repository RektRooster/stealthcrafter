import { getJimmyConsoleData } from "@/lib/jimmy/data";
import JimmyConsole from "./jimmy-console";

export const dynamic = "force-dynamic";

export default async function JimmyPage() {
  let data = null;
  let loadError: string | null = null;
  try {
    data = await getJimmyConsoleData();
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (!data || !data.configured) {
    return (
      <main className="cc-container">
        <div className="cc-notice">
          <strong>Jimmy console is offline.</strong>{" "}
          {loadError
            ? `Data load failed: ${loadError}`
            : "Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."}
        </div>
      </main>
    );
  }

  return <JimmyConsole data={data} />;
}
