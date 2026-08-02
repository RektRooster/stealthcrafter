import SfPlaceholder from "../sf-placeholder";

export default function StorefrontKitBuilderPage() {
  return (
    <SfPlaceholder
      title="Kit Builder"
      description={
        <>
          At launch this is the primary recommendation engine: it uses the
          customer&apos;s Preparedness Profile to create complete preparedness
          systems rather than shopping baskets. The first release offers the
          flagship starter kit and pillar add-ons, with the full modular
          configurator phased in later. Checkout attaches the first year of
          membership.
        </>
      }
      feed="Fed by SC 06 — Business Model (starter kits, pillar add-ons, pricing) and SC 03 — Jimmy (the Preparedness Profile)."
    />
  );
}
