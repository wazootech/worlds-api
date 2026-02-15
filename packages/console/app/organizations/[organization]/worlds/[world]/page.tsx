import { WorldOverviewContent } from "@/components/world-overview-content";
import type { Metadata } from "next";
import { sdk } from "@/lib/sdk";

export async function generateMetadata(props: {
  params: Promise<{ organization: string; world: string }>;
}): Promise<Metadata> {
  const { organization: organizationSlug, world: worldSlug } = await props.params;

  try {
     // We need to fetch the world to get the label.
     // But sdk.worlds.get requires worldId (or slug??).
     // world parameter is "ethans-world" (slug).
     // But sdk.worlds.get usually takes ID.
     // Currently layout.tsx does: sdk.worlds.get(worldId, { organizationId })

     // Wait, the params are just strings.
     // layout.tsx logic:
     // 1. Fetch Org (by slug or id)
     // 2. Fetch World (by slug or id)

     const organization = await sdk.organizations.get(organizationSlug);
     if (!organization) return { title: "World Overview" };

     const world = await sdk.worlds.get(worldSlug, { organizationId: organization.id });
     if (!world) return { title: "World Overview" };

     const orgSlug = organization.slug || organization.id;
     const worldSlugTitle = world.slug || world.id;

     return {
       title: {
         absolute: `${worldSlugTitle} | ${orgSlug} | Wazoo`
       }
     };
  } catch (e) {
    return { title: "World Overview" };
  }
}

export default function WorldOverviewPage() {
  return <WorldOverviewContent />;
}
