"use client";

import { useOrganization } from "@/components/organization-context";
import { PageHeader } from "@/components/page-header";
import { usePathname } from "next/navigation";

export function OrganizationHeader() {
  const { organization, user, isAdmin } = useOrganization();
  const pathname = usePathname();
  const orgSlug = organization.slug || organization.id;

  // Check if we are on a world-specific page
  // Pattern: /organizations/[org]/worlds/[world]...
  const isWorldPage = pathname?.includes(`/organizations/${orgSlug}/worlds/`);

  if (isWorldPage) {
    return null;
  }

  return (
    <PageHeader
      user={user}
      isAdmin={isAdmin}
      tabs={[
        { label: "Worlds", href: `/organizations/${orgSlug}` },
        {
          label: "Service Accounts",
          href: `/organizations/${orgSlug}/service-accounts`,
        },
        { label: "Metrics", href: `/organizations/${orgSlug}/metrics` },
        { label: "Settings", href: `/organizations/${orgSlug}/settings` },
      ]}
    />
  );
}
