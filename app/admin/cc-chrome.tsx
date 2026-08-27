"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/* Small stroke icons used across the Command Center chrome. */
export function CcIcon({ name, size = 14 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <path d="M3 11l9-8 9 8" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      );
    case "map":
      return (
        <svg {...common}>
          <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
          <path d="M9 4v14M15 6v14" />
        </svg>
      );
    case "products":
      return (
        <svg {...common}>
          <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" />
          <path d="M3 7l9 5 9-5M12 12v10" />
        </svg>
      );
    case "suppliers":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" />
          <circle cx="17.5" cy="9.5" r="2.4" />
          <path d="M16 15.3c2.9.2 4.9 1.6 5.5 4.7" />
        </svg>
      );
    case "competitors":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "testing":
      return (
        <svg {...common}>
          <path d="M9 3h6M10 3v6l-5.5 9.2A2 2 0 006.2 21h11.6a2 2 0 001.7-2.8L14 9V3" />
          <path d="M7.5 15h9" />
        </svg>
      );
    case "compliance":
      return (
        <svg {...common}>
          <path d="M12 2l8 3.5v5.7c0 5-3.4 8.6-8 10.8-4.6-2.2-8-5.8-8-10.8V5.5L12 2z" />
          <path d="M8.5 12l2.4 2.4 4.6-4.8" />
        </svg>
      );
    case "jimmy":
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="4" />
          <path d="M4.5 21c1-4.2 4-6 7.5-6s6.5 1.8 7.5 6" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
        </svg>
      );
    case "orders":
      return (
        <svg {...common}>
          <path d="M3 4h3l2.5 12.5a1.5 1.5 0 001.5 1.2h8.6a1.5 1.5 0 001.5-1.2L22 8H7" />
          <circle cx="10.5" cy="21" r="1.3" />
          <circle cx="18" cy="21" r="1.3" />
        </svg>
      );
    case "customers":
      return (
        <svg {...common}>
          <circle cx="8.5" cy="8" r="3.2" />
          <path d="M2 20c.8-3.6 3.4-5.2 6.5-5.2S14.2 16.4 15 20" />
          <circle cx="16.5" cy="8.8" r="2.6" />
          <path d="M15.5 14.6c3.2 0 5.6 1.5 6.3 5.1" />
        </svg>
      );
    case "logo":
      return (
        <svg {...common} width={size} height={size} strokeWidth={1.6}>
          <path d="M12 2l8.7 5v10L12 22l-8.7-5V7L12 2z" />
          <path d="M12 6.5l4.8 2.75v5.5L12 17.5l-4.8-2.75v-5.5L12 6.5z" />
        </svg>
      );
    default:
      return null;
  }
}

const TABS = [
  { href: "/admin/overview", label: "Overview", icon: "overview" },
  { href: "/admin/map", label: "Map", icon: "map" },
  { href: "/admin", label: "Products", icon: "products" },
  { href: "/admin/suppliers", label: "Suppliers", icon: "suppliers" },
  { href: "/admin/competitors", label: "Competitors", icon: "competitors" },
  { href: "/admin/testing", label: "Testing", icon: "testing" },
  { href: "/admin/compliance", label: "Compliance", icon: "compliance" },
  { href: "/admin/orders", label: "Orders", icon: "orders" },
  { href: "/admin/customers", label: "Customers", icon: "customers" },
  { href: "/admin/jimmy", label: "Jimmy", icon: "jimmy" },
  { href: "/admin/feeds", label: "Feeds", icon: "map" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
];

export function CcNav() {
  const path = usePathname() || "/admin";
  return (
    <nav className="cc-nav" aria-label="Command Center modules">
      {TABS.map((t) => {
        const active =
          t.href === "/admin"
            ? path === "/admin" || path.startsWith("/admin/product")
            : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`cc-tab${active ? " active" : ""}`}>
            <CcIcon name={t.icon} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* STOREFRONT PREVIEW tier — the future public site, built behind the  */
/* gate. Brass on ink (brand canon palette) so it is instantly clear   */
/* what is admin-only (cyan row above) vs what becomes the live store. */
/* ------------------------------------------------------------------ */
const SF_TABS = [
  { href: "/admin/site/home", label: "Home" },
  { href: "/admin/site/jimmy", label: "Jimmy" },
  { href: "/admin/site/guides", label: "Guides" },
  { href: "/admin/site/catalogue", label: "Catalogue" },
  { href: "/admin/site/kit-builder", label: "Kit Builder" },
  { href: "/admin/site/tested", label: "Tested Reports" },
  { href: "/admin/site/dashboard", label: "My Dashboard" },
  { href: "/admin/site/conditions", label: "By Country" },
  { href: "/admin/site/sources", label: "Sources" },
];

/* Basket and Account sit apart from the browse tabs — they are where you ARE,
   not where you are going, and a live count belongs next to the basket rather
   than buried in a row of nine links. */

export function SfNav({ basketCount = 0 }: { basketCount?: number }) {
  const path = usePathname() || "/admin";
  return (
    <nav className="sf-nav" aria-label="Storefront preview pages">
      <span
        className="sf-navlabel"
        title="Pages on this row are built behind the gate and will become the public site at launch."
      >
        STOREFRONT — PREVIEW · NOT PUBLIC
        <span className="info" aria-hidden="true">
          ⓘ
        </span>
      </span>
      {SF_TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`sf-tab${path.startsWith(t.href) ? " active" : ""}`}
        >
          {t.label}
        </Link>
      ))}
      <span className="sf-navspacer" aria-hidden="true" />
      <Link
        href="/admin/site/account"
        className={`sf-tab${path.startsWith("/admin/site/account") ? " active" : ""}`}
      >
        Account
      </Link>
      <Link
        href="/admin/site/basket"
        className={`sf-tab basket${path.startsWith("/admin/site/basket") ? " active" : ""}`}
      >
        Basket
        {basketCount > 0 ? <span className="sf-basketpip">{basketCount}</span> : null}
      </Link>
    </nav>
  );
}

function sectionFor(path: string): string {
  if (path.startsWith("/admin/site")) {
    const seg = path.split("/")[3];
    return seg ? `STOREFRONT / ${seg.replace(/-/g, " ").toUpperCase()}` : "STOREFRONT";
  }
  if (path.startsWith("/admin/product/new")) return "NEW PRODUCT";
  if (path.startsWith("/admin/product/")) return "STOCK ITEM";
  if (path === "/admin" || path === "/admin/") return "PRODUCTS";
  const seg = path.split("/")[2];
  return seg ? seg.toUpperCase() : "PRODUCTS";
}

export function CcSectionTitle() {
  const path = usePathname() || "/admin";
  return (
    <span className="cc-title">
      COMMAND <span className="cy">CENTER</span>
      <span className="sep">/</span>
      <span className="sec">{sectionFor(path)}</span>
    </span>
  );
}

function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function CcClock() {
  const now = useNow();
  const time = now ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` : "--:--:--";
  const date = now
    ? now
        .toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" })
        .toUpperCase()
    : "";
  return (
    <>
      <span className="cc-clock-time" suppressHydrationWarning>{time}</span>
      <span className="cc-clock-date" suppressHydrationWarning>{date || " "}</span>
    </>
  );
}

export function CcFooterTime() {
  const now = useNow();
  return (
    <span suppressHydrationWarning>
      {now ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : "--:--"}
    </span>
  );
}
