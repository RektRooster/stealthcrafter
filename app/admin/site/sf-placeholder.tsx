// Shared skeleton for STOREFRONT PREVIEW placeholder pages.
// Each page states what it will be AT LAUNCH (per Website & Platform
// Architecture v2.0) — no fake content, no lorem ipsum.
export default function SfPlaceholder({
  title,
  description,
  feed,
}: {
  title: string;
  description: React.ReactNode;
  feed?: string;
}) {
  return (
    <main className="sf-page">
      <div className="sf-inner">
        <div className="sf-place">
          <h1>{title}</h1>
          <div className="sf-rule" />
          <span className="sf-chip">COMING ONLINE</span>
          <p className="sf-desc">{description}</p>
          {feed ? <div className="sf-feed">{feed}</div> : null}
          <div className="sf-footnote">
            STOREFRONT PREVIEW — copy and design pending SC 09 brand pass
          </div>
        </div>
      </div>
    </main>
  );
}
