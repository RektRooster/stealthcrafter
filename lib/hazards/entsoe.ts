// ENTSO-E Transparency Platform — European power system conditions.
//
// Deliberately NOT a blackout predictor. What this layer does is watch
// published unavailability of generation and transmission capacity and flag
// where the European grid is carrying unusual stress — which is exactly the
// reading that matters when it lands on top of a heatwave, a storm or a
// wildfire in the same region.
//
// The Transparency Platform API requires a free security token: register at
// transparency.entsoe.eu, email transparency@entsoe.eu with subject
// "RESTful API access", then generate the token under My Account and set it
// as ENTSOE_API_TOKEN. Without it this layer reports itself as unconfigured
// rather than showing anything invented.
import { countryPointLonLat, projectLonLat } from "@/lib/euro-map";
import { PILLARS_BY_KIND, safeFetch } from "./types";
import type { HazardEvent, Severity, SourceStatus } from "./types";

const API = "https://web-api.tp.entsoe.eu/api";

// Bidding-zone / control-area EIC codes. Default coverage is the largest
// markets so one page render stays inside the serverless budget; widen with
// ENTSOE_ZONES (comma-separated ISO2 codes).
const ZONES: Record<string, string> = {
  DE: "10Y1001A1001A82H", // DE-LU
  FR: "10YFR-RTE------C",
  IT: "10YIT-GRTN-----B",
  ES: "10YES-REE------0",
  PL: "10YPL-AREA-----S",
  NL: "10YNL----------L",
  BE: "10YBE----------2",
  SE: "10YSE-1--------K",
  AT: "10YAT-APG------L",
  CZ: "10YCZ-CEPS-----N",
  PT: "10YPT-REN------W",
  GR: "10YGR-HTSO-----Y",
  RO: "10YRO-TEL------P",
  FI: "10YFI-1--------U",
  DK: "10YDK-1--------W",
  IE: "10Y1001A1001A59C",
  HU: "10YHU-MAVIR----U",
  BG: "10YCA-BULGARIA-R",
  SK: "10YSK-SEPS-----K",
  HR: "10YHR-HEP------M",
  SI: "10YSI-ELES-----O",
  LT: "10YLT-1001A0008Q",
  LV: "10YLV-1001A00074",
  EE: "10Y1001A1001A39I",
  LU: "10YLU-CEGEDEL-NQ",
};

const DEFAULT_COVERAGE = ["DE", "FR", "IT", "ES", "PL", "NL", "BE", "SE", "AT", "CZ"];

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}00`;
}

export async function fetchEntsoe(): Promise<{ events: HazardEvent[]; status: SourceStatus }> {
  const base: SourceStatus = {
    source: "ENTSOE",
    label: "Power grid",
    what: "Published unavailability of European generation and transmission capacity — where the grid is under unusual stress, not a blackout forecast.",
    state: "needs-key",
    detail: "",
    fetchedAt: null,
    count: 0,
    attribution: "ENTSO-E Transparency Platform",
    href: "https://transparency.entsoe.eu/",
  };

  const token = process.env.ENTSOE_API_TOKEN;
  if (!token) {
    return {
      events: [],
      status: {
        ...base,
        state: "needs-key",
        detail:
          "Not connected — ENTSO-E requires a free API security token. Register at transparency.entsoe.eu, " +
          'email transparency@entsoe.eu with the subject "RESTful API access" (approval takes up to 3 working days), ' +
          "generate the token under My Account, then set ENTSOE_API_TOKEN in Vercel. The adapter is built and will " +
          "come online the moment the token is present.",
      },
    };
  }

  const coverage = (process.env.ENTSOE_ZONES || DEFAULT_COVERAGE.join(","))
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => ZONES[s]);

  const now = new Date();
  const periodStart = stamp(now);
  const periodEnd = stamp(new Date(now.getTime() + 48 * 3600e3));

  const events: HazardEvent[] = [];
  const failures: string[] = [];

  // Bounded concurrency so one render cannot fan out into 27 serial XML calls.
  const queue = [...coverage];
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const iso2 = queue.shift();
      if (!iso2) return;
      const domain = ZONES[iso2];
      // A80 = unavailability of generation units.
      const url =
        `${API}?securityToken=${encodeURIComponent(token)}&documentType=A80` +
        `&biddingZone_Domain=${domain}&periodStart=${periodStart}&periodEnd=${periodEnd}`;
      const r = await safeFetch(url, { revalidate: 1800, timeoutMs: 10000 });
      if (!r.ok) {
        failures.push(`${iso2}: ${r.detail}`);
        continue;
      }
      let xml = "";
      try {
        xml = await r.res.text();
      } catch {
        failures.push(`${iso2}: response unreadable`);
        continue;
      }
      // "No matching data found" comes back as an Acknowledgement document.
      if (/Acknowledgement_MarketDocument/i.test(xml)) continue;

      const mw = sumUnavailableMw(xml);
      if (mw <= 0) continue;

      const severity: Severity = mw >= 6000 ? "severe" : mw >= 3000 ? "elevated" : mw >= 1000 ? "watch" : "info";
      if (severity === "info") continue;

      const ll = countryPointLonLat(iso2);
      if (!ll) continue;
      events.push({
        id: `ENTSOE:${iso2}:${periodStart}`,
        source: "ENTSOE",
        kind: "grid",
        title: `Grid capacity offline — ${iso2}`,
        summary:
          `About ${Math.round(mw).toLocaleString("en-GB")} MW of generation capacity is published as unavailable in ` +
          `${iso2} over the next 48 hours. This is planned and unplanned outage data, not a blackout warning — it ` +
          `matters most when it coincides with extreme weather in the same region.`,
        lat: ll[1],
        lon: ll[0],
        xy: projectLonLat(ll[0], ll[1]),
        countryIso2: iso2,
        severity,
        magnitude: Math.round(mw),
        unit: "MW",
        at: now.toISOString(),
        url: "https://transparency.entsoe.eu/outage-domain/r2/unavailabilityOfProductionAndGenerationUnits/show",
        pillars: PILLARS_BY_KIND.grid,
      });
    }
  });
  await Promise.all(workers);

  return {
    events,
    status: {
      ...base,
      state: events.length ? "live" : failures.length === coverage.length ? "error" : "empty",
      detail: events.length
        ? `${events.length} of ${coverage.length} covered markets showing notable capacity offline (next 48h).`
        : failures.length === coverage.length
        ? `ENTSO-E rejected every request — ${failures[0] || "unknown error"}. Check ENTSOE_API_TOKEN.`
        : `Connected across ${coverage.length} markets; none currently above the reporting threshold.`,
      fetchedAt: new Date().toISOString(),
      count: events.length,
    },
  };
}

/** Sum the quantity of each unavailable period in an ENTSO-E outage document. */
function sumUnavailableMw(xml: string): number {
  // Each TimeSeries carries an available/unavailable quantity per position.
  // We take the peak reduction per TimeSeries and sum across series.
  let total = 0;
  for (const block of xml.split(/<TimeSeries>/).slice(1)) {
    const nominal = Number((block.match(/<nominal_?[Pp]ower[^>]*>([\d.]+)</) || [])[1] || NaN);
    const quantities = [...block.matchAll(/<quantity>([\d.]+)<\/quantity>/g)].map((m) => Number(m[1]));
    if (!quantities.length) continue;
    const minAvailable = Math.min(...quantities);
    if (Number.isFinite(nominal) && nominal > 0) total += Math.max(0, nominal - minAvailable);
    else total += Math.max(0, Math.max(...quantities) - minAvailable);
  }
  return total;
}
