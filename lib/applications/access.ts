export function documentAccess(requestOrganizationId: string, documentOrganizationId: string) {
  if (!requestOrganizationId || requestOrganizationId !== documentOrganizationId) return "deny" as const;
  return "allow" as const;
}
