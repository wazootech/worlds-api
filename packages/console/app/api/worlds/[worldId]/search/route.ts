import { type NextRequest, NextResponse } from "next/server";
import { getSdkForOrg } from "@/lib/org-sdk";
import * as authkit from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ worldId: string }> },
) {
  try {
    const { user } = await authkit.withAuth();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve organization from user metadata
    const orgId = user.metadata?.organizationId as string;
    if (!orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        {
          status: 400,
        },
      );
    }

    const orgMgmt = await authkit.getOrganizationManagement();
    const organization = await orgMgmt.getOrganization(orgId);
    if (!organization) {
      return NextResponse.json(
        { error: "Organization not found" },
        {
          status: 404,
        },
      );
    }
    const sdk = getSdkForOrg(organization);
    const { worldId } = await params;
    const body = await request.text();
    const query = body;

    // Resolve world to ensure we have the actual ID for sub-resource call
    const world = await sdk.worlds.get(worldId);
    if (!world) {
      return NextResponse.json({ error: "World not found" }, { status: 404 });
    }
    const results = await sdk.worlds.search(world.id, query);

    return NextResponse.json(results);
  } catch (error) {
    console.error("Search error:", error);
    return new NextResponse(
      error instanceof Error ? error.message : "Internal Server Error",
      { status: 500 },
    );
  }
}
