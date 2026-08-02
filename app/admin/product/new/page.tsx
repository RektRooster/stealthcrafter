import { getCategoryList } from "@/lib/data";
import ProductEditor from "../editor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function NewProductPage() {
  const categories = await getCategoryList();
  const blank = { product_status: "draft", research_stage: "pending", currency: "EUR", needs_review: false };
  return (
    <main className="cc-container">
      <div className="cc-panel" style={{ padding: 0 }}>
        <div className="cc-panel-h" style={{ padding: "16px 18px 0", marginBottom: 0 }}>
          Register New Product
        </div>
        <div className="cc-embed">
          <ProductEditor product={blank} categories={categories} mode="create" />
        </div>
      </div>
    </main>
  );
}
