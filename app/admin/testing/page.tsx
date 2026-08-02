import { getTestLabHome } from "@/lib/testing-data";
import TestLabHome from "./test-lab-home";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TestingPage() {
  const data = await getTestLabHome();
  if (!data) {
    return (
      <main className="cc-container">
        <div className="cc-notice">
          Data source not configured — set <code>SUPABASE_URL</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code> to bring the Test Lab online.
        </div>
      </main>
    );
  }
  return <TestLabHome data={data} />;
}
