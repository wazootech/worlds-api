import { withAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { AccountSettingsContent } from "@/components/account-settings-content";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account Settings",
};

export default async function AccountPage() {
  const { user } = await withAuth();

  return (
    <>
      <PageHeader user={user} />
      <AccountSettingsContent user={user} />
    </>
  );
}
