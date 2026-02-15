import { notFound, redirect } from "next/navigation";
import * as authkit from "@/lib/auth";
import { sdk } from "@/lib/sdk";
import { PageHeader } from "@/components/page-header";
import { WorldTripleSearch } from "@/components/world-triple-search";

export default async function WorldSearchPage({
  params,
}: {
  params: Promise<{ organizationId: string; worldId: string }>;
}) {
  const { organizationId, worldId } = await params;
  const { user } = await authkit.withAuth();

  if (!user) {
    const signInUrl = await authkit.getSignInUrl();
    redirect(signInUrl);
  }

  const world = await sdk.worlds.get(worldId);
  if (!world) {
    notFound();
  }

  const organization = await sdk.organizations.get(organizationId);
  if (!organization) {
    notFound();
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-stone-50/50 dark:bg-stone-900/50">
      <PageHeader
        user={user}
        resource={[
          {
            label: organization.label || "Organization",
            href: `/organizations/${organizationId}`,
          },
          {
            label: "Worlds",
            href: `/organizations/${organizationId}/worlds`,
          },
          {
            label: world.label || "World",
            href: `/organizations/${organizationId}/worlds/${worldId}`,
            icon: null,
            menuItems: [
              {
                label: "Overview",
                href: `/organizations/${organizationId}/worlds/${worldId}`,
              },
              {
                label: "SPARQL",
                href: `/organizations/${organizationId}/worlds/${worldId}/sparql`,
              },
              {
                label: "Search",
                href: `/organizations/${organizationId}/worlds/${worldId}/search`,
              },
              {
                label: "Settings",
                href: `/organizations/${organizationId}/worlds/${worldId}/settings`,
              },
            ],
          },
          { label: "Search" },
        ]}
        tabs={[
          {
            label: "Overview",
            href: `/organizations/${organizationId}/worlds/${worldId}`,
          },
          {
            label: "SPARQL",
            href: `/organizations/${organizationId}/worlds/${worldId}/sparql`,
          },
          {
            label: "Search",
            href: `/organizations/${organizationId}/worlds/${worldId}/search`,
          },
          {
            label: "Settings",
            href: `/organizations/${organizationId}/worlds/${worldId}/settings`,
          },
        ]}
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-8 max-w-7xl mx-auto w-full">
        <WorldTripleSearch worldId={worldId} />
      </div>
    </div>
  );
}
