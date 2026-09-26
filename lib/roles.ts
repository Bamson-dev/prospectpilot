import type { MembershipRole } from "@prisma/client";

const RANK: Record<MembershipRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function roleAtLeast(actual: MembershipRole, required: MembershipRole) {
  return RANK[actual] >= RANK[required];
}
