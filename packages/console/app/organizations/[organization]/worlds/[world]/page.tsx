import { WorldOverviewContent } from "@/components/world-overview-content";
import type { Metadata } from "next";
import { getSdkForOrg } from "@/lib/org-sdk";

export async function generateMetadata(props: {
  params: Promise<{ organization: string; world: string }>;
}): Promise<Metadata> {
  const { organization: organizationSlug, world: worldSlug } =
    await props.params;

  try {
    const { getOrganizationManagement } = await import("@/lib/auth");
    const orgMgmt = await getOrganizationManagement();
    let organization;
    if (organizationSlug.startsWith("org_")) {
      organization = await orgMgmt.getOrganization(organizationSlug);
    } else {
      organization =
        await orgMgmt.getOrganizationByExternalId(organizationSlug);
    }
    if (!organization) return { title: "World Overview" };

    const sdk = getSdkForOrg(organization);
    const world = await sdk.worlds.get(worldSlug);
    if (!world) return { title: "World Overview" };

    const orgSlug = organization.externalId || organization.id;
    const worldSlugTitle = world.slug || world.id;

    return {
      title: {
        absolute: `${worldSlugTitle} | ${orgSlug} | Wazoo`,
      },
    };
  } catch {
    return { title: "World Overview" };
  }
}

export default function WorldOverviewPage() {
  return <WorldOverviewContent />;
}
