export function auditPackage(input: {
  claimsOk: boolean;
  documentsOk: boolean;
  captcha: boolean;
  authentication: boolean;
  unresolvedRequired: number;
}) {
  const blocking = !input.claimsOk || !input.documentsOk || input.captcha || input.authentication || input.unresolvedRequired > 0;
  return {
    status: blocking ? "PACKAGE_REQUIRES_REVIEW" as const : "PACKAGE_READY" as const,
    inspect: !input.captcha && !input.authentication,
    fill: !blocking,
  };
}
