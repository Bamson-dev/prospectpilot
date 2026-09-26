export function belongsToOrganization(record: { organizationId: string } | null | undefined, organizationId: string) {
  return Boolean(record && record.organizationId === organizationId);
}
