import { getTestedIndex } from "@/lib/tested-data";
import TestedIndexView from "./tested-index";

export const dynamic = "force-dynamic";

export default async function TestedPage() {
  const data = await getTestedIndex();
  if (!data.configured) {
    return (
      <main className="sf-page">
        <div className="sf-inner">
          <div className="cc-notice">
            <strong>Tested Reports are offline.</strong> Supabase is not configured.
          </div>
        </div>
      </main>
    );
  }
  return <TestedIndexView data={data} />;
}
