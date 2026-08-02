import SfPlaceholder from "../sf-placeholder";

export default function StorefrontDashboardPage() {
  return (
    <SfPlaceholder
      title="My Dashboard"
      description={
        <>
          At launch this is the family&apos;s preparedness headquarters, kept
          deliberately lean: an equipment register, maintenance and expiry
          reminders, and the household preparedness score. Richer features —
          manuals, training progress, Jimmy conversation history and annual
          review status — are added in later phases.
        </>
      }
      feed="Fed by SC 03 — Jimmy (Preparedness Profile and score roll-up) and SC 05 — Platform (accounts and data spine)."
    />
  );
}
