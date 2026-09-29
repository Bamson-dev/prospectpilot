import { mapCandidateToFields, type InspectedField, type MappedAnswer } from "@/lib/applications/form-map";
import { detectPlatform, type PlatformName } from "@/lib/applications/platforms";
import { detectSecurityBarrier, type SecurityReason } from "@/lib/applications/security";

export type AdapterInspection = {
  platform: PlatformName;
  fields: InspectedField[];
  mapped: MappedAnswer[];
  security: SecurityReason | null;
};

export type ApplicationAdapter = {
  name: PlatformName;
  detect: (url: string, html?: string) => boolean;
  inspect: (fields: InspectedField[]) => InspectedField[];
  mapFields: (fields: InspectedField[], values: Record<string, string | null | undefined>) => MappedAnswer[];
  prepare: () => { mode: "PREPARE_ONLY"; submit: false };
  validate: (mapped: MappedAnswer[]) => { ok: boolean; review: string[] };
  requiresManualAction: (input: { text: string; fieldTypes?: Array<string | null | undefined>; mapped: MappedAnswer[] }) => SecurityReason | "unknown-required-field" | null;
};

const NAMES: PlatformName[] = ["GREENHOUSE", "LEVER", "ASHBY", "WORKABLE", "SMARTRECRUITERS", "GENERIC", "UNKNOWN"];

export function adapterFor(url: string, html?: string): ApplicationAdapter {
  const name = detectPlatform({ url, html });
  return buildAdapter(name);
}

export function adapters() {
  return NAMES.map((name) => buildAdapter(name));
}

function buildAdapter(name: PlatformName): ApplicationAdapter {
  return {
    name,
    detect(url, html) {
      return detectPlatform({ url, html }) === name;
    },
    inspect(fields) {
      return fields;
    },
    mapFields(fields, values) {
      return mapCandidateToFields(fields, values);
    },
    prepare() {
      return { mode: "PREPARE_ONLY", submit: false };
    },
    validate(mapped) {
      const review = mapped.filter((item) => item.status !== "ANSWERED").map((item) => item.reason ?? item.name);
      return { ok: review.length === 0, review };
    },
    requiresManualAction(input) {
      const security = detectSecurityBarrier(input);
      if (security) return security;
      if (input.mapped.some((item) => item.status === "UNSUPPORTED")) return "unknown-required-field";
      return null;
    },
  };
}
