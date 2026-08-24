import Link from "next/link";
import { notFound } from "next/navigation";
import { getReport } from "@/lib/tested-data";
import type { Checkpoint } from "@/lib/tested-data";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, { label: string; tone: string; line: string }> = {
  pass: { label: "PASS", tone: "go", line: "Cleared every safety-critical checkpoint." },
  review: { label: "REVIEW", tone: "warm", line: "Usable, with a finding you need to know about." },
  fail: { label: "FAIL", tone: "stop", line: "Did not pass. We will not carry it on this result." },
};

const RESULT: Record<string, { mark: string; cls: string; label: string }> = {
  pass: { mark: "✓", cls: "v-yes", label: "Met" },
  fail: { mark: "×", cls: "v-no", label: "Missed" },
  na: { mark: "–", cls: "v-unknown", label: "Not applicable" },
  waiting: { mark: "–", cls: "v-unknown", label: "Not run" },
  in_progress: { mark: "–", cls: "v-unknown", label: "In progress" },
};

export default async function ReportPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const r = await getReport(decodeURIComponent(code));
  if (!r) notFound();

  const v = VERDICT[r.verdict ?? "review"];
  const sections = groupBySection(r.checkpoints);
  const misses = r.checkpoints.filter((c) => c.result === "fail");
  const measured = r.checkpoints.filter((c) => c.measured !== null);

  return (
    <main className="sf-page">
      <div className="sf-catwrap">
        <Link href="/admin/site/tested" className="sf-back">
          ← Tested Reports
        </Link>

        {r.demo && (
          <div className="sf-specimen">
            <strong>Specimen report.</strong> This is demonstration data used while the storefront is
            built. It is not a real StealthCrafter test result and no product should be judged on it.
          </div>
        )}

        <header className={`sf-rephead v-${r.verdict}`}>
          <div className="sf-repmain">
            <span className={`sf-state t-${v.tone} big`}>{v.label}</span>
            {r.brand && <div className="sf-pdpbrand">{r.brand}</div>}
            <h1>{r.productName}</h1>
            <p className="sf-repverdictline">{v.line}</p>
            {r.summary && <p className="sf-repsummary">{r.summary}</p>}
            <div className="sf-repactions">
              {r.productSlug && (
                <Link href={`/admin/site/catalogue/${r.productSlug}`} className="sf-hz-ask">
                  See this product in the catalogue →
                </Link>
              )}
              <Link href="/admin/site/tested/protocol" className="sf-hz-locate">
                How we test
              </Link>
            </div>
          </div>
          <div className="sf-repmedia">
            {r.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.image} alt="" className="sf-pdpimg" decoding="async" />
            ) : (
              <div className="sf-pdpnoimg">No image yet</div>
            )}
          </div>
        </header>

        {/* ---- the score + the conditions ---- */}
        <section className="sf-repbar">
          <div>
            <dt>Checkpoints</dt>
            <dd>
              <span className="ok">{r.passed}</span> met
              {r.failed > 0 && (
                <>
                  {" · "}
                  <span className="bad">{r.failed}</span> missed
                </>
              )}
              {r.na > 0 && <> · {r.na} n/a</>}
              <em>of {r.total}</em>
            </dd>
          </div>
          <div>
            <dt>Conditions</dt>
            <dd>
              {[
                r.location,
                r.temperature !== null ? `${r.temperature}°C` : null,
                r.humidity !== null ? `${r.humidity}% RH` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Not recorded"}
            </dd>
          </div>
          <div>
            <dt>Bench time</dt>
            <dd>{r.minutes ? `${r.minutes} min` : "—"}</dd>
          </div>
          <div>
            <dt>Tested</dt>
            <dd>
              {r.completedAt
                ? new Date(r.completedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>{r.revision || "Not recorded"}</dd>
          </div>
          <div>
            <dt>Report</dt>
            <dd>{r.code}</dd>
          </div>
        </section>

        {r.supersededNote && (
          <div className="sf-superseded">
            <strong>This result may be out of date.</strong> {r.supersededNote}
          </div>
        )}

        {/* ---- pre-registration, stated plainly ---- */}
        <section className="sf-prereg">
          <h2>We wrote down what we expected before we opened the box</h2>
          <p>
            Every &ldquo;expected&rdquo; value below comes from the protocol template, authored ahead
            of the session and applied identically to every product in this category. That is what
            stops a review being written backwards from whatever the product turned out to do.
          </p>
        </section>

        {/* ---- what it missed ---- */}
        {misses.length > 0 && (
          <section className="sf-misses">
            <h2>
              What it missed — {misses.length} of {r.total}
            </h2>
            {misses.map((c) => (
              <div key={c.id} className="sf-miss">
                <div className="sf-misshead">
                  <strong>{c.name}</strong>
                  <span>{c.sectionName}</span>
                </div>
                <div className="sf-missgrid">
                  <div>
                    <dt>We expected</dt>
                    <dd>{c.expected}</dd>
                  </div>
                  <div>
                    <dt>We measured</dt>
                    <dd className="bad">
                      {c.measured !== null ? `${c.measured.toLocaleString("en-GB")} ${c.measuredUnit ?? ""}` : "Missed"}
                    </dd>
                  </div>
                </div>
                {c.notes && <p>{c.notes}</p>}
              </div>
            ))}
          </section>
        )}

        {/* ---- measured figures ---- */}
        {measured.length > 0 && (
          <section className="sf-panelbox">
            <h2>What we measured</h2>
            <p className="sf-kblede">
              These are our numbers, not the manufacturer&apos;s. Where they differ from the box, the
              Kit Builder uses ours.
            </p>
            <div className="sf-measured">
              {measured.map((c) => (
                <div key={c.id}>
                  <dt>{c.name}</dt>
                  <dd>
                    {c.measured!.toLocaleString("en-GB")} <span>{c.measuredUnit}</span>
                  </dd>
                  <span className="sf-measexp">expected {c.expected}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---- the full protocol run ---- */}
        <section className="sf-panelbox">
          <h2>Every checkpoint we ran</h2>
          <p className="sf-kblede">
            The whole session, in order, exactly as recorded on the bench.
          </p>
          {sections.map((sec) => (
            <div key={sec.section} className="sf-cpsection">
              <div className="sf-cpsectionhead">
                <span className="sf-cpnum">{sec.section}</span>
                {sec.name}
                <span className="sf-cpcount">{sec.items.length} checkpoints</span>
              </div>
              <table className="sf-cptable">
                <thead>
                  <tr>
                    <th />
                    <th>Checkpoint</th>
                    <th>Method</th>
                    <th>Expected</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {sec.items.map((c) => {
                    const res = RESULT[c.result] ?? RESULT.waiting;
                    return (
                      <tr key={c.id} className={res.cls}>
                        <td className="sf-cpmark">
                          <span>{res.mark}</span>
                        </td>
                        <td className="sf-cpname">{c.name}</td>
                        <td className="sf-cpmethod">{c.method}</td>
                        <td className="sf-cpexp">{c.expected}</td>
                        <td className="sf-cpres">
                          <strong>
                            {c.measured !== null
                              ? `${c.measured.toLocaleString("en-GB")} ${c.measuredUnit ?? ""}`
                              : res.label}
                          </strong>
                          {c.notes && <span>{c.notes}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        <div className="sf-footnote">
          STOREFRONT PREVIEW — gated, not public. StealthCrafter is not a certification body; these
          are our own bench results under the conditions stated above.
        </div>
      </div>
    </main>
  );
}

function groupBySection(cps: Checkpoint[]) {
  const map: Record<number, { section: number; name: string; items: Checkpoint[] }> = {};
  for (const c of cps) {
    (map[c.section] ||= { section: c.section, name: c.sectionName, items: [] }).items.push(c);
  }
  return Object.values(map).sort((a, b) => a.section - b.section);
}
