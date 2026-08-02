import Link from "next/link";
import { getTestSessionFull, RESOLVED } from "@/lib/testing-data";
import {
  RESULT_META,
  displayName,
  fmtDateTime,
  fmtDuration,
  scId,
  verdictMeta,
} from "../../../lab-utils";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TestReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getTestSessionFull(id);

  if (!data) {
    return (
      <main className="cc-container">
        <div className="cc-notice">Data source not configured.</div>
      </main>
    );
  }
  if (!data.session) {
    return (
      <main className="cc-container">
        <Link className="cc-back" href="/admin/testing">← TEST LAB</Link>
        <div className="cc-notice" style={{ marginTop: 16 }}>Test session not found.</div>
      </main>
    );
  }

  const { session, checkpoints, product } = data;
  const v = verdictMeta(session.verdict);
  const total = checkpoints.length;
  const resolved = checkpoints.filter((c) => RESOLVED.has(c.result)).length;
  const passes = checkpoints.filter((c) => c.result === "pass").length;
  const fails = checkpoints.filter((c) => c.result === "fail").length;
  const nas = checkpoints.filter((c) => c.result === "na").length;
  const duration = session.completed_at
    ? fmtDuration(new Date(session.completed_at).getTime() - new Date(session.started_at).getTime())
    : "—";

  const sections = new Map<number, { name: string; items: typeof checkpoints }>();
  for (const c of checkpoints) {
    const e = sections.get(c.section) || { name: c.section_name, items: [] as typeof checkpoints };
    e.items.push(c);
    sections.set(c.section, e);
  }

  return (
    <main className="cc-container cc-lab-report">
      <div className="cc-lab-repbar">
        <Link className="cc-back" href={`/admin/testing/session/${session.id}`}>
          ← BACK TO CONSOLE
        </Link>
        <PrintButton />
      </div>

      <div className="cc-panel cc-lab-repsheet">
        <header className="rephead">
          <div>
            <div className="brand">STEALTHCRAFTER · TEST LAB</div>
            <h1>PRODUCT TEST REPORT</h1>
            <div className="code">{session.test_code || session.id}</div>
          </div>
          <div className={`verdictbox ${v.tone}`}>
            <span className="l">VERDICT</span>
            <span className="v">{session.status === "completed" ? v.label : session.status.toUpperCase()}</span>
          </div>
        </header>

        <section className="repmeta">
          <div>
            <span className="k">Product</span>
            <span className="v">{displayName(product)}</span>
          </div>
          <div>
            <span className="k">SKU / ID</span>
            <span className="v">{scId(product)}</span>
          </div>
          <div>
            <span className="k">Pillar / Category</span>
            <span className="v">
              {product?.pillar || "—"} · {product?.category || "—"}
            </span>
          </div>
          <div>
            <span className="k">Tested By</span>
            <span className="v">{session.started_by || "—"}</span>
          </div>
          <div>
            <span className="k">Started</span>
            <span className="v">{fmtDateTime(session.started_at)}</span>
          </div>
          <div>
            <span className="k">Completed</span>
            <span className="v">{fmtDateTime(session.completed_at)}</span>
          </div>
          <div>
            <span className="k">Duration</span>
            <span className="v">{duration}</span>
          </div>
          <div>
            <span className="k">Location</span>
            <span className="v">{session.location || "—"}</span>
          </div>
          <div>
            <span className="k">Environment</span>
            <span className="v">
              {session.temperature != null ? `${session.temperature} °C` : "—"} ·{" "}
              {session.humidity != null ? `${session.humidity} %` : "—"}
            </span>
          </div>
        </section>

        <section className="reptiles">
          <div className="tile">
            <span className="n">{resolved}/{total}</span>
            <span className="l">CHECKPOINTS RESOLVED</span>
          </div>
          <div className="tile green">
            <span className="n">{passes}</span>
            <span className="l">PASS</span>
          </div>
          <div className="tile red">
            <span className="n">{fails}</span>
            <span className="l">FAIL</span>
          </div>
          <div className="tile amber">
            <span className="n">{nas}</span>
            <span className="l">N/A</span>
          </div>
        </section>

        {session.notes ? (
          <section className="repnotes">
            <h2>SESSION NOTES</h2>
            <p>{session.notes}</p>
          </section>
        ) : null}

        {[...sections.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([num, sec]) => (
            <section key={num} className="repsection">
              <h2>
                {num}. {sec.name.toUpperCase()}
              </h2>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "24%" }}>Checkpoint</th>
                    <th style={{ width: "24%" }}>Method</th>
                    <th style={{ width: "22%" }}>Expected</th>
                    <th style={{ width: "10%" }}>Result</th>
                    <th>Notes / Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {sec.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {num}.{c.seq} {c.name}
                      </td>
                      <td>{c.method || "—"}</td>
                      <td>{c.expected || "—"}</td>
                      <td>
                        <span className={`res ${c.result}`}>{RESULT_META[c.result]?.label || c.result}</span>
                      </td>
                      <td>{c.notes_evidence || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}

        <footer className="repfoot">
          Generated by StealthCrafter Command Center · Test Lab ·{" "}
          {session.test_code || session.id} · Proprietary &amp; Confidential
        </footer>
      </div>
    </main>
  );
}
