import { getCategoryList } from "@/lib/data";
import ProductEditor from "../editor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function NewProductPage() {
  const categories = await getCategoryList();
  const blank = { product_status: "draft", research_stage: "pending", currency: "EUR", needs_review: false };
  return <ProductEditor product={blank} categories={categories} mode="create" />;
}
