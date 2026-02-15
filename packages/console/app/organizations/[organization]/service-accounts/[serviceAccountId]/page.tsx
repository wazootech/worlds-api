import * as authkit from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { sdk } from "@/lib/sdk";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ShieldCheck, LayoutGrid, BarChart3, Settings } from "lucide-react";
import { ServiceAccountDetails } from "@/components/service-account-details";

type Params = { organization: string; serviceAccountId: string };

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { organization: organizationSlug, serviceAccountId } =
    await props.params;

  try {
    const organization = await sdk.organizations.get(organizationSlug);
    if (!organization) return { title: "Service Account Details" };

    const sa = await sdk.organizations.serviceAccounts.get(
      organization.id,
      serviceAccountId,
    );

    if (!sa) {
      return { title: "Service Account Details" };
    }

    return {
      title: `${sa.label || sa.id} | Service Accounts`,
    };
  } catch {
    return {
      title: "Service Account Details",
    };
  }
}

export default async function ServiceAccountDetailsPage(props: {
  params: Promise<Params>;
}) {
  const { organization: organizationSlug, serviceAccountId } =
    await props.params;

  // Check authentication
  const { user } = await authkit.withAuth();
  if (!user) {
    const signInUrl = await authkit.getSignInUrl();
    redirect(signInUrl);
  }

  const isAdmin = !!user?.metadata?.admin;

  // Fetch data
  const organization = await sdk.organizations
    .get(organizationSlug)
    .catch(() => null);

  if (!organization) {
    notFound();
  }

  const sa = await sdk.organizations.serviceAccounts
    .get(organization.id, serviceAccountId)
    .catch(() => null);

  if (!sa) {
    notFound();
  }

  const orgSlug = organization.slug || organization.id;

  const resourceMenuItems = [
    {
      label: "Worlds",
      href: `/organizations/${orgSlug}`,
      icon: <LayoutGrid className="w-4 h-4" />,
    },
    {
      label: "Service Accounts",
      href: `/organizations/${orgSlug}/service-accounts`,
      icon: <ShieldCheck className="w-4 h-4" />,
    },
    {
      label: "Metrics",
      href: `/organizations/${orgSlug}/metrics`,
      icon: <BarChart3 className="w-4 h-4" />,
    },
    {
      label: "Settings",
      href: `/organizations/${orgSlug}/settings`,
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  const breadcrumbs = [
    {
      label: "Service Accounts",
      href: `/organizations/${orgSlug}/service-accounts`,
      icon: <ShieldCheck className="w-3 h-3 text-stone-500" />,
      menuItems: resourceMenuItems,
    },
    {
      label: sa.label || sa.id,
      href: `/organizations/${orgSlug}/service-accounts/${serviceAccountId}`,
      icon: <ShieldCheck className="w-3 h-3 text-stone-500" />,
    },
  ];

  const tabs = [
    {
      label: "Overview",
      href: `/organizations/${orgSlug}/service-accounts/${serviceAccountId}`,
    },
    {
      label: "Settings",
      href: `/organizations/${orgSlug}/service-accounts/${serviceAccountId}/settings`,
    },
  ];

  return (
    <>
      <PageHeader
        user={user}
        isAdmin={isAdmin}
        resource={breadcrumbs}
        tabs={tabs}
      />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <ServiceAccountDetails
          serviceAccount={sa}
          organizationId={organization.id}
        />
      </main>
    </>
  );
}
