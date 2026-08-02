import Link from "next/link";
import { getTestSessionFull } from "@/lib/testing-data";
import TestConsole from "./test-console";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TestSessionPage({ params }: { params: Promise<{ id: string }> }) {
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
  return (
    <TestConsole
      session={data.session}
      checkpoints={data.checkpoints}
      product={data.product}
      routes={data.routes}
    />
  );
}
