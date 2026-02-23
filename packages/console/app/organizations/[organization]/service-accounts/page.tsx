import { ServiceAccountsContent } from "@/components/service-accounts-content";
import * as authkit from "@/lib/auth";
import { getSdkForOrg } from "@/lib/org-sdk";
import type { ServiceAccount } from "@wazoo/sdk";
import { notFound } from "next/navigation";
import { Metadata } from "next";

type Params = { organization: string };
type SearchParams = { page?: string; pageSize?: string };

export const metadata: Metadata = {
  title: "Service Accounts",
};

export default async function ServiceAccountsPage(props: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { organization: organizationId } = await props.params;
  const searchParams = await props.searchParams;

  const page = parseInt(searchParams.page || "1");
  const pageSize = parseInt(searchParams.pageSize || "20");

  // Fetch organization (verify organization existence)
  let organization;
  try {
    const orgMgmt = await authkit.getOrganizationManagement();
    organization = await orgMgmt.getOrganizationByExternalId(organizationId);
  } catch (error) {
    console.error("Failed to fetch organization:", error);
    notFound();
  }

  if (!organization) {
    notFound();
  }

  const actualOrgId = organization.id;

  let serviceAccounts: ServiceAccount[] = [];
  try {
    const sdk = getSdkForOrg(organization);
    serviceAccounts = await sdk.serviceAccounts.list(actualOrgId, {
      page: 1,
      pageSize: 100,
    });
  } catch (error) {
    console.error("Failed to list service accounts:", error);
  }

  return (
    <ServiceAccountsContent
      serviceAccounts={serviceAccounts}
      page={page}
      pageSize={pageSize}
    />
  );
}
