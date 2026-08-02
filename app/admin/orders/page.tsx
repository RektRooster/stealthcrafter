import ModuleStub from "../module-stub";

export const dynamic = "force-dynamic";

export default function OrdersPage() {
  return (
    <ModuleStub
      title="ORDERS & FULFILMENT"
      icon="orders"
      desc="Order pipeline, fulfilment routing to the ES/SK nodes, shipping status and returns. Comes online with checkout: needs the payments provider (SC 05/06 decision, deferred to launch phase) and the customer accounts layer. Until then there are no orders to show — this console will read live order data only, never samples."
    />
  );
}
