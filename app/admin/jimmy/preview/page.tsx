import { redirect } from "next/navigation";

// The customer Jimmy experience has been re-homed to the STOREFRONT PREVIEW
// tier. Old links keep working via this redirect.
export default function LegacyJimmyPreviewRedirect() {
  redirect("/admin/site/jimmy");
}
