import Link from "next/link";
import { getProtocol } from "@/lib/tested-data";

export const dynamic = "force-dynamic";

// Publishing the protocol is the credibility play: anyone can repeat what we did.
export default async function ProtocolPage() {
  const rows = await getProtocol();
  const generic = rows.filter((r: any) => !r.category_hint);
  const specific = rows.filter((r: any) => r.category_hint);
  const bySection: Record<number, any[]> = {};
  generic.forEach((r: any) => (bySection[r.section] ||= []).push(r));
  const specialByCat: Record<string, any[]> = {};
  specific.forEach((r: any) => (specialByCat[r.category_hint] ||= []).push(r));

  return (
    <main className="sf-page">
      <div className="sf-catwrap">
        <Link href="/admin/site/tested" className="sf-back">
          ← Tested Reports
        </Link>
        <header className="sf-cathead wide">
          <div className="sf-hz-kicker">The protocol</div>
          <h1>How we test — every product, every time.</h1>
          <p>
            This is the whole thing, published so you can repeat it. Six sections, run in order, with
            the expected outcome written before the session begins. Categories with their own physics
            get an additional set that replaces the generic functional tests.
          </p>
        </header>

        {Object.values(bySection).map((items) => (
          <div key={items[0].section} className="sf-cpsection">
            <div className="sf-cpsectionhead">
              <span className="sf-cpnum">{items[0].section}</span>
              {items[0].section_name}
              <span className="sf-cpcount">{items.length} checkpoints</span>
            </div>
            <table className="sf-cptable">
              <thead>
                <tr>
                  <th>Checkpoint</th>
                  <th>Method</th>
                  <th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r: any) => (
                  <tr key={`${r.section}-${r.seq}-${r.name}`}>
                    <td className="sf-cpname">{r.name}</td>
                    <td className="sf-cpmethod">{r.method}</td>
                    <td className="sf-cpexp">{r.expected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {Object.entries(specialByCat).map(([cat, items]) => (
          <div key={cat} className="sf-cpsection">
            <div className="sf-cpsectionhead">
              <span className="sf-cpnum">+</span>
              {cat} — category-specific functional tests
              <span className="sf-cpcount">{items.length} checkpoints</span>
            </div>
            <table className="sf-cptable">
              <thead>
                <tr>
                  <th>Checkpoint</th>
                  <th>Method</th>
                  <th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r: any) => (
                  <tr key={`${cat}-${r.seq}-${r.name}`}>
                    <td className="sf-cpname">{r.name}</td>
                    <td className="sf-cpmethod">{r.method}</td>
                    <td className="sf-cpexp">{r.expected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      </div>
    </main>
  );
}
