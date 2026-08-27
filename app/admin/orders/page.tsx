import { adminOrderList } from "@/lib/commerce/orders";
import OrdersConsole from "./orders-console";

export const dynamic = "force-dynamic";

// ORDERS & FULFILMENT — live from the commerce demo.
// Was an honest placeholder for as long as there was nothing to show. There is
// now: real orders placed through the storefront, with a real status lifecycle.
export default async function OrdersPage() {
  const rows = await adminOrderList();
  return (
    <div className="cc-page">
      <OrdersConsole rows={rows} />
    </div>
  );
}
