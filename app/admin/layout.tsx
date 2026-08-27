import { CcClock, CcFooterTime, CcIcon, CcNav, CcSectionTitle, SfNav } from "./cc-chrome";
import { basketCount } from "@/lib/commerce/basket";
import { currentCustomer, currentGuestKey } from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  /* Read here rather than in each page so the pip is right on every screen —
     including the ones Jimmy adds things from. Never throws: a basket that
     cannot be counted shows no pip rather than taking the chrome down. */
  let count = 0;
  try {
    const customer = await currentCustomer();
    const guestKey = await currentGuestKey();
    count = await basketCount({ customerId: customer?.id ?? null, guestKey });
  } catch {
    count = 0;
  }

  return (
    <div className="cc-shell">
      <header className="cc-topbar">
        <div className="cc-brand">
          <span className="cc-logomark">
            <CcIcon name="logo" size={20} />
          </span>
          <span className="cc-brandtext">
            <span className="cc-brandname">STEALTHCRAFTER</span>
            <span className="cc-brandtag">BUILD · PREPARE · PROTECT</span>
          </span>
        </div>
        <div className="cc-titleblock">
          <CcSectionTitle />
        </div>
        <div className="cc-topright">
          <div className="cc-sys">
            <span className="cc-syslabel">SYSTEM STATUS</span>
            <span className="cc-sysval">NOMINAL</span>
          </div>
          <div className="cc-clockblock">
            <CcClock />
          </div>
          <form method="POST" action="/api/logout">
            <button className="cc-signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <CcNav />
      <SfNav basketCount={count} />
      <div className="cc-body">{children}</div>
      <footer className="cc-footer">
        <span className="cc-sync">
          DATA SYNC <span className="cc-dot">●</span> LIVE
        </span>
        <span className="cc-conf">Proprietary &amp; Confidential · Founder Access Only</span>
        <span className="cc-updated">
          LAST UPDATED <CcFooterTime />
        </span>
      </footer>
    </div>
  );
}
