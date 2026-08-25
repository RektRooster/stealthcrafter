import { getEuroGeo } from "@/lib/euro-geo";
import { getLiveSnapshot, summariseByCountry } from "@/lib/live-conditions";
import { getHomeDashboard } from "@/lib/home-dashboard";
import LiveEurope from "./live-europe";

export const dynamic = "force-dynamic";

// CUSTOMER HOME.
//
// One full-height surface: satellite imagery of Europe with live conditions on
// it, every panel floating over the top. Data assembly happens here on the
// server — the client gets plain JSON and a map engine.
//
// Conditions now come from lib/live-conditions, which merges the ingest spine's
// stored alerts with the five original pan-European adapters. See that file for
// why the two paths coexist.
export default async function HomePage() {
  const geo = getEuroGeo();
  const [snapshot, dash] = await Promise.all([getLiveSnapshot(), getHomeDashboard()]);
  const { byCountry } = summariseByCountry(snapshot.events);

  return (
    <LiveEurope
      geo={geo.fc}
      bounds={geo.bounds}
      events={snapshot.events}
      sources={snapshot.sources}
      feeds={snapshot.feeds}
      credits={snapshot.credits}
      generatedAt={snapshot.generatedAt}
      dash={dash}
    />
  );
}
