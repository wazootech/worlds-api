"use client";

import { useSelectedLayoutSegment, usePathname } from "next/navigation";
import { Globe, Settings, ShieldCheck, LayoutGrid } from "lucide-react";
import { useOrganization } from "@/components/organization-context";
import { PageHeader } from "@/components/page-header";

export function OrganizationHeader() {
  const { organization, user, isAdmin } = useOrganization();
  const pathname = usePathname();
  const segment = useSelectedLayoutSegment();
  const orgSlug = organization.slug;
  if (!orgSlug) throw new Error("Organization is missing a slug");

  // Organization layout is a parent of World layout.
  // If the segment is not null (org home) or '~' (org settings), we are in a world sub-route.
  if (segment !== null && segment !== "~") {
    return null;
  }

  const isSettings = segment === "~";
  const currentLabel = isSettings ? "Settings" : "Worlds";
  const currentIcon = isSettings ? (
    <Settings className="w-3 h-3 text-stone-500" />
  ) : (
    <LayoutGrid className="w-3 h-3 text-stone-500" />
  );

  const menuItems = [
    {
      label: "Worlds",
      href: `/${orgSlug}`,
      icon: <Globe className="w-4 h-4" />,
    },
    {
      label: "Settings",
      href: `/${orgSlug}/~/settings`,
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  return (
    <PageHeader
      user={user}
      isAdmin={isAdmin}
      resource={{
        label: currentLabel,
        href: isSettings ? `/${orgSlug}/~/settings` : `/${orgSlug}`,
        icon: currentIcon,
        menuItems: menuItems,
      }}
      tabs={[
        { label: "Worlds", href: `/${orgSlug}` },
        { label: "Settings", href: `/${orgSlug}/~/settings` },
      ]}
    />
  );
}
