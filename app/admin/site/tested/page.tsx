import SfPlaceholder from "../sf-placeholder";

export default function StorefrontTestedPage() {
  return (
    <SfPlaceholder
      title="Tested Reports"
      description={
        <>
          At launch these are the public trust proof behind the
          &ldquo;StealthCrafter Tested&rdquo; badge: individual testing reports
          that remain publicly viewable even though the full browsable
          catalogue is member-gated — never gating the evidence a prospective
          customer needs to trust us. Every badge on a product links to the
          report behind it.
        </>
      }
      feed="Fed by the Test Lab (SC 01 testing programme) — sessions, checkpoints and verdicts recorded in the admin Testing module."
    />
  );
}
