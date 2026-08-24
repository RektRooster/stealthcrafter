import { getPortalData } from "@/lib/portal-data";
import Portal from "./portal";

export const dynamic = "force-dynamic";

// STOREFRONT PREVIEW — the customer portal.
// Behind the /admin gate; becomes the member area once auth lands. The household
// switcher stands in for "logged in as" until then.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string; s?: string }>;
}) {
  const { h, s } = await searchParams;
  const data = await getPortalData(h, s);

  if (!data.configured || !data.household) {
    return (
      <main className="sf-page">
        <div className="sf-inner">
          <div className="cc-notice">
            <strong>The portal is offline.</strong>{" "}
            {data.configured
              ? "No household profiles exist yet — create one in the Jimmy console."
              : "Supabase is not configured."}
          </div>
        </div>
      </main>
    );
  }

  return <Portal data={data} />;
}
