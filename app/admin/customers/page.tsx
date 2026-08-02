import ModuleStub from "../module-stub";

export const dynamic = "force-dynamic";

export default function CustomersPage() {
  return (
    <ModuleStub
      title="CUSTOMERS"
      icon="customers"
      desc="Member accounts, Preparedness Profiles, membership status and support history. Comes online with member auth (Supabase Auth) — and per the platform tripwire, no real personal or household data is collected until the legal/privacy/insurance wrapper is live. Test households live in the Jimmy console meanwhile; every customer table ships with own-row RLS from day one."
    />
  );
}
