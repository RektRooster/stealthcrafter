import { getEuroGeo } from "@/lib/euro-geo";
import { getHazardSnapshot } from "@/lib/hazards";
import { getHomeDashboard } from "@/lib/home-dashboard";
import LiveEurope from "./live-europe";

export const dynamic = "force-dynamic";

// CUSTOMER HOME.
//
// The page is a single full-height surface: satellite imagery of Europe with
// live conditions on it, and every panel floating over the top. All the data
// assembly happens here on the server — the client gets plain JSON and a
// map engine.
export default async function HomePage() {
  const geo = getEuroGeo();
  const [snapshot, dash] = await Promise.all([getHazardSnapshot(), getHomeDashboard()]);

  return (
    <LiveEurope
      geo={geo.fc}
      bounds={geo.bounds}
      events={snapshot.events}
      sources={snapshot.sources}
      generatedAt={snapshot.generatedAt}
      dash={dash}
    />
  );
}
