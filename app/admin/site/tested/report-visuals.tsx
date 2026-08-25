import { BAD, OK, SEVERITY } from "@/lib/palette";
// Shared report graphics. Pure SVG, no dependencies, readable at a glance —
// the point of the page is that you can see the result before you read it.
import type { Checkpoint, SectionScore } from "@/lib/tested-data";

const TONE: Record<string, string> = {
  pass: OK,
  review: SEVERITY.elevated,
  fail: BAD,
};

/** Verdict donut: passed / missed / not-applicable, with the score in the middle. */
export function ScoreRing({
  passed,
  failed,
  na,
  verdict,
  size = 148,
}: {
  passed: number;
  failed: number;
  na: number;
  verdict: string | null;
  size?: number;
}) {
  const total = Math.max(1, passed + failed + na);
  const r = size / 2 - 13;
  const c = 2 * Math.PI * r;
  const seg = (n: number) => (n / total) * c;
  const colour = TONE[verdict ?? "review"];

  let offset = 0;
  const arcs: { len: number; colour: string; from: number }[] = [];
  for (const [n, col] of [
    [passed, colour],
    [failed, BAD],
    [na, "rgba(22,32,43,.16)"],
  ] as [number, string][]) {
    if (n > 0) {
      arcs.push({ len: seg(n), colour: col, from: offset });
      offset += seg(n);
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="sf-ring" role="img"
         aria-label={`${passed} of ${total} checkpoints met`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(22,32,43,.10)" strokeWidth="11" />
      {arcs.map((a, i) => (
        <circle
          key={i}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={a.colour}
          strokeWidth="11"
          strokeLinecap="butt"
          strokeDasharray={`${a.len} ${c - a.len}`}
          strokeDashoffset={-a.from}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ))}
      <text x="50%" y="47%" textAnchor="middle" className="sf-ringnum" style={{ fill: colour }}>
        {passed}
      </text>
      <text x="50%" y="63%" textAnchor="middle" className="sf-ringsub">
        of {total} met
      </text>
    </svg>
  );
}

/** Per-section pass rate — you should see instantly which section it stumbled in. */
export function SectionScorecard({ sections }: { sections: SectionScore[] }) {
  return (
    <div className="sf-scorecard">
      {sections.map((s) => {
        const clean = s.failed === 0;
        return (
          <div key={s.section} className={`sf-scorerow${clean ? "" : " miss"}`}>
            <span className="sf-cpnum">{s.section}</span>
            <span className="sf-scorename">{s.name}</span>
            <div className="sf-scoretrack">
              <div className="sf-scorebar" style={{ width: `${s.rate * 100}%` }} />
              {s.failed > 0 && (
                <div className="sf-scorebar miss" style={{ width: `${(s.failed / s.total) * 100}%` }} />
              )}
            </div>
            <span className="sf-scoreval">
              {s.passed}/{s.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Measured value against the threshold we pre-registered. */
export function MeasuredGauge({ c }: { c: Checkpoint }) {
  const measured = c.measured ?? 0;
  const th = c.threshold;
  const max = Math.max(measured, th ?? 0) * 1.28 || 1;
  const met = th === null ? true : c.thresholdDir === "max" ? measured <= th : measured >= th;

  return (
    <div className="sf-gauge">
      <div className="sf-gaugehead">
        <strong>{c.name}</strong>
        <span className={met ? "ok" : "bad"}>
          {measured.toLocaleString("en-GB")} {c.measuredUnit}
        </span>
      </div>
      <div className="sf-gaugetrack">
        <div
          className={`sf-gaugebar${met ? "" : " bad"}`}
          style={{ width: `${Math.min(100, (measured / max) * 100)}%` }}
        />
        {th !== null && (
          <div className="sf-gaugeth" style={{ left: `${Math.min(100, (th / max) * 100)}%` }}>
            <span>{th.toLocaleString("en-GB")}</span>
          </div>
        )}
      </div>
      <div className="sf-gaugefoot">
        We expected {c.expected || "—"} · {met ? "met" : "missed"}
      </div>
    </div>
  );
}

/** Evidence slots. Empty until SC 01 shoots them, but the layout is proven. */
export function Evidence({ urls }: { urls: string[] }) {
  if (urls.length) {
    return (
      <div className="sf-evidence">
        {urls.slice(0, 4).map((u) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={u} src={u} alt="" decoding="async" />
        ))}
      </div>
    );
  }
  return (
    <div className="sf-evidence">
      <div className="sf-evslot">Photo pending</div>
    </div>
  );
}
