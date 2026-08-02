import Link from "next/link";
import { getProduct, getCategoryList } from "@/lib/data";
import ProductEditor from "../editor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, categories] = await Promise.all([getProduct(id), getCategoryList()]);

  if (!result) {
    return <main className="container"><div className="notice">Data source not configured.</div></main>;
  }
  const { product, routes, sources } = result;
  if (!product) {
    return (
      <main className="container">
        <Link className="back" href="/admin">← Back to catalogue</Link>
        <div className="notice" style={{ marginTop: 16 }}>Product not found.</div>
      </main>
    );
  }
  return <ProductEditor product={product} categories={categories} routes={routes} sources={sources} mode="edit" />;
}
