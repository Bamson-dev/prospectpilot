export function selectOrganizationMembership<T extends { organizationId: string }>(
  memberships: T[],
  requestedOrganizationId: string | null | undefined,
) {
  if (requestedOrganizationId) {
    return memberships.find((membership) => membership.organizationId === requestedOrganizationId) ?? null;
  }
  return memberships.length === 1 ? memberships[0] : null;
}
