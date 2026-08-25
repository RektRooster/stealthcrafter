import { REGISTRY, registryStats, blockedFeeds } from "@/lib/feeds/registry";
import { supabaseAdmin } from "@/lib/supabase";
import { countryName } from "@/lib/iso-ids";

export const dynamic = "force-dynamic";

// ACCESS & FEED HEALTH — operator page.
//
// The list of things Ace has to go and get is GENERATED from the registry, not
// written by hand, so it cannot drift out of date while we build. Every row
// names what is blocked, what blocks it, where to go, and what it unlocks.
export default async function FeedsPage() {
  const sb = supabaseAdmin();
  const stats = registryStats();
  const blocked = blockedFeeds();

  const live = sb
    ? ((await sb
        .from("feeds")
        .select("id, enabled, last_status, last_success_at, last_run_at, consecutive_failures")
        .limit(500)).data as any[]) || []
    : [];
  const liveById = new Map(live.map((f) => [f.id, f]));
  const enabled = live.filter((f) => f.enabled);
  const failing = enabled.filter((f) => f.last_status === "error" || f.last_status === "needs-key");

  // Group the blocked set by what would actually unblock it, because that is
  // the unit of work: one registration, one email, one signed agreement.
  const groups: { key: string; title: string; blurb: string; rows: typeof blocked }[] = [
    {
      key: "needs-registration",
      title: "Free account or self-service key",
      blurb: "Minutes each. Register, accept the terms, put the key in Vercel env — never in chat.",
      rows: blocked.filter((f) => f.access_state === "needs-registration"),
    },
    {
      key: "needs-key",
      title: "API key by request",
      blurb: "A form or an email, then a key. Usually days.",
      rows: blocked.filter((f) => f.access_state === "needs-key"),
    },
    {
      key: "needs-contract",
      title: "Signed agreement or written consent",
      blurb: "The authority requires a contract for commercial use. Weeks.",
      rows: blocked.filter((f) => f.access_state === "needs-contract"),
    },
    {
      key: "licence",
      title: "Licence unresolved",
      blurb:
        "Data exists and is reachable, but the terms either prohibit our use or could not be established. These never render until resolved.",
      rows: blocked.filter(
        (f) =>
          f.access_state !== "needs-registration" &&
          f.access_state !== "needs-key" &&
          f.access_state !== "needs-contract"
      ),
    },
  ];

  return (
    <div className="cc-container">
      <div className="cc-panel">
        <div className="cc-panel-h">FEED REGISTRY</div>
        <div className="cc-stats">
          <Stat label="Feeds registered" value={String(stats.total)} />
          <Stat label="Countries" value={String(stats.countries)} />
          <Stat label="Enabled" value={String(stats.enabled)} />
          <Stat label="Reporting" value={String(enabled.filter((f) => f.last_status === "ok" || f.last_status === "empty").length)} />
          <Stat label="Failing" value={String(failing.length)} tone={failing.length ? "bad" : "ok"} />
          <Stat label="Needing you" value={String(blocked.length)} tone={blocked.length ? "warn" : "ok"} />
        </div>
        <p className="cc-note">
          Registered from SC 13&apos;s Feed Register v1.0 plus the SC 05 Phase 0 re-verification.
          Every row can be built and tested while dark; <code>licence_state</code> decides whether it
          renders and <code>auth_env</code> names the environment variable, never the secret.
        </p>
      </div>

      {failing.length > 0 && (
        <div className="cc-panel">
          <div className="cc-panel-h">NOT REPORTING</div>
          <div className="cc-tablewrap"><table className="cc-table">
            <thead>
              <tr><th>Feed</th><th>Status</th><th>Last success</th><th>Consecutive failures</th></tr>
            </thead>
            <tbody>
              {failing.map((f) => (
                <tr key={f.id}>
                  <td>{f.id}</td>
                  <td>{f.last_status}</td>
                  <td>{f.last_success_at ? new Date(f.last_success_at).toLocaleString("en-GB") : "never"}</td>
                  <td>{f.consecutive_failures}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {groups.map((g) =>
        g.rows.length ? (
          <div className="cc-panel" key={g.key}>
            <div className="cc-panel-h">
              {g.title.toUpperCase()} · {g.rows.length}
            </div>
            <p className="cc-note">{g.blurb}</p>
            <div className="cc-tablewrap"><table className="cc-table">
              <thead>
                <tr>
                  <th>Country</th><th>Type</th><th>Authority</th><th>Where to go</th><th>What it unlocks</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.slice(0, 80).map((f) => (
                  <tr key={f.id}>
                    <td>{f.country_iso2 ? countryName(f.country_iso2) || f.country_iso2 : "EU"}</td>
                    <td>{f.kind.replace(/-/g, " ")}</td>
                    <td>{f.authority.slice(0, 90)}</td>
                    <td>
                      {f.access_contact ? (
                        <a href={`mailto:${f.access_contact}`}>{f.access_contact}</a>
                      ) : f.access_url ? (
                        <a href={f.access_url} target="_blank" rel="noreferrer noopener">
                          {hostOf(f.access_url)}
                        </a>
                      ) : (
                        <span className="cc-muted">no contact recorded</span>
                      )}
                    </td>
                    <td className="cc-muted">
                      {f.auth_env ? `env ${f.auth_env}` : f.licence_state === "blocked" ? "licence" : "access"}
                      {" · "}
                      {f.register_status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {g.rows.length > 80 && <p className="cc-note">…and {g.rows.length - 80} more.</p>}
          </div>
        ) : null
      )}

      <div className="cc-panel">
        <div className="cc-panel-h">REGISTRY BREAKDOWN</div>
        <div className="cc-stats">
          {Object.entries(stats.byLicence).map(([k, v]) => (
            <Stat key={k} label={`licence ${k}`} value={String(v)} />
          ))}
        </div>
        <div className="cc-stats">
          {Object.entries(stats.byStatus).map(([k, v]) => (
            <Stat key={k} label={k.toLowerCase()} value={String(v)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const cls = tone === "bad" ? " red" : tone === "warn" ? " amber" : tone === "ok" ? " green" : " cyan";
  return (
    <div className={`cc-stat${cls}`}>
      <div className="n">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return u.slice(0, 40);
  }
}
