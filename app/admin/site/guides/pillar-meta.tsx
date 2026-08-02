// Knowledge Hub — shared pillar metadata + inline SVG icons (sf-kh-*).
// Pure module: safe to import from both server and client components.
// No photographic imagery — CSS gradients + stroked SVG only (SC 09 pending).

export type GuideRow = {
  slug: string;
  title: string;
  pillar: string | null;
  category: string;
  featured: boolean;
  read_min: number;
  summary: string;
  status: string;
};

export type PillarKey = "Water" | "Shelter" | "Fire" | "Medical" | "Food" | "beyond";

export const PILLARS: {
  key: PillarKey;
  label: string;
  desc: string;
  cls: string;
}[] = [
  { key: "Water", label: "Water", desc: "Secure clean, safe water for any situation", cls: "p-water" },
  { key: "Shelter", label: "Shelter", desc: "Stay protected from the elements", cls: "p-shelter" },
  { key: "Fire", label: "Fire", desc: "Heat, cooking and ignition under all conditions", cls: "p-fire" },
  { key: "Medical", label: "Medical", desc: "First aid and health resilience", cls: "p-medical" },
  { key: "Food", label: "Food", desc: "Nutrition and storage for the long term", cls: "p-food" },
  { key: "beyond", label: "Beyond the Five", desc: "Power, communications, navigation and more", cls: "p-beyond" },
];

function Stroke({ children, size = 24 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function PillarIcon({ pillar, size = 24 }: { pillar: string | null | undefined; size?: number }) {
  switch (pillar) {
    case "Water":
      return (
        <Stroke size={size}>
          <path d="M12 3.2C12 3.2 6 10.2 6 14.2a6 6 0 0 0 12 0c0-4-6-11-6-11Z" />
          <path d="M9.4 14.6a2.7 2.7 0 0 0 2 2.5" opacity="0.7" />
        </Stroke>
      );
    case "Shelter":
      return (
        <Stroke size={size}>
          <path d="M12 4.5 3 19.5h6.4L12 14l2.6 5.5H21L12 4.5Z" />
          <path d="M3 19.5h18" opacity="0.7" />
        </Stroke>
      );
    case "Fire":
      return (
        <Stroke size={size}>
          <path d="M12 3c1.1 3.9 5.2 5.4 5.2 9.8a5.2 5.2 0 0 1-10.4 0c0-2.5 1.4-4.2 2.7-5.9.5 1.7 1.3 2.5 2.5 3.1-.4-2.4-.4-4.7 0-7Z" />
          <path d="M12 18.9a2.6 2.6 0 0 1-2.4-2.6c0-1.2.8-2 1.5-2.9.4 1 1 1.4 1.7 1.8" opacity="0.7" />
        </Stroke>
      );
    case "Medical":
      return (
        <Stroke size={size}>
          <path d="M9.2 4h5.6v5.2H20v5.6h-5.2V20H9.2v-5.2H4V9.2h5.2V4Z" />
        </Stroke>
      );
    case "Food":
      return (
        <Stroke size={size}>
          <path d="M12 21V8" />
          <path d="M12 11.5c-3 0-4.5-2.2-4.5-5 3 0 4.5 2 4.5 5Z" />
          <path d="M12 11.5c3 0 4.5-2.2 4.5-5-3 0-4.5 2-4.5 5Z" />
          <path d="M12 16c-2.6 0-4-1.9-4-4.4 2.6 0 4 1.8 4 4.4Z" />
          <path d="M12 16c2.6 0 4-1.9 4-4.4-2.6 0-4 1.8-4 4.4Z" />
          <path d="M12 8c-.9-1-.9-2.6 0-4 .9 1.4.9 3 0 4Z" />
        </Stroke>
      );
    default:
      // Beyond the Five — compass
      return (
        <Stroke size={size}>
          <circle cx="12" cy="12" r="8.2" />
          <path d="M15.4 8.6 13.3 13.3 8.6 15.4l2.1-4.7 4.7-2.1Z" />
        </Stroke>
      );
  }
}

// Small utility icons used across the hub (trust markers, value strip, cards)
export function MiniIcon({ name, size = 18 }: { name: string; size?: number }) {
  switch (name) {
    case "shield":
      return (
        <Stroke size={size}>
          <path d="M12 3.5 5 6v5.2c0 4.3 2.9 7.4 7 9.3 4.1-1.9 7-5 7-9.3V6l-7-2.5Z" />
          <path d="m9.2 12 2 2 3.6-3.8" />
        </Stroke>
      );
    case "scales":
      return (
        <Stroke size={size}>
          <path d="M12 4.5v15M7.5 19.5h9M12 6.5 6.5 8M12 6.5 17.5 8" />
          <path d="M6.5 8l-2.3 5a2.6 2.6 0 0 0 4.6 0L6.5 8ZM17.5 8l-2.3 5a2.6 2.6 0 0 0 4.6 0L17.5 8Z" />
        </Stroke>
      );
    case "book":
      return (
        <Stroke size={size}>
          <path d="M12 6.2C10.4 4.9 8.2 4.5 5 4.5v13.2c3.2 0 5.4.4 7 1.8 1.6-1.4 3.8-1.8 7-1.8V4.5c-3.2 0-5.4.4-7 1.7Z" />
          <path d="M12 6.2v13.3" opacity="0.7" />
        </Stroke>
      );
    case "home":
      return (
        <Stroke size={size}>
          <path d="m4 11.5 8-7 8 7" />
          <path d="M6.2 9.8v9.7h11.6V9.8" />
          <path d="M10.2 19.5v-5h3.6v5" opacity="0.8" />
        </Stroke>
      );
    case "compass":
      return (
        <Stroke size={size}>
          <circle cx="12" cy="12" r="8.2" />
          <path d="M15.4 8.6 13.3 13.3 8.6 15.4l2.1-4.7 4.7-2.1Z" />
        </Stroke>
      );
    case "clock":
      return (
        <Stroke size={size}>
          <circle cx="12" cy="12" r="8.2" />
          <path d="M12 7.5V12l3 1.8" />
        </Stroke>
      );
    case "bolt":
      return (
        <Stroke size={size}>
          <path d="M13.2 3 5.5 13.4h5L10.8 21l7.7-10.4h-5L13.2 3Z" />
        </Stroke>
      );
    case "flag":
      return (
        <Stroke size={size}>
          <path d="M6 21V4" />
          <path d="M6 5h11.5l-2.4 3.5 2.4 3.5H6" />
        </Stroke>
      );
    case "chat":
      return (
        <Stroke size={size}>
          <path d="M4.5 6.5A2 2 0 0 1 6.5 4.5h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-4 4v-4H6.5a2 2 0 0 1-2-2v-7Z" />
        </Stroke>
      );
    case "arrow":
      return (
        <Stroke size={size}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </Stroke>
      );
    default:
      return null;
  }
}

// Chip metadata for a guide card: pillar name, or a category fallback for
// cross-pillar guides (scenario / beginner).
export function guideChip(g: GuideRow): { label: string; cls: string; icon: string | null } {
  if (g.pillar) {
    const p = PILLARS.find((x) => x.key === g.pillar);
    return { label: g.pillar.toUpperCase(), cls: p?.cls || "p-beyond", icon: null };
  }
  if (g.category === "scenario") return { label: "PREPAREDNESS", cls: "p-beyond", icon: "bolt" };
  if (g.category === "beginner") return { label: "BEGINNER", cls: "p-beyond", icon: "flag" };
  return { label: g.category.toUpperCase(), cls: "p-beyond", icon: "compass" };
}
