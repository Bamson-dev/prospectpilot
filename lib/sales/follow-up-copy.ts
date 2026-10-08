export type FollowUpAngle = {
  title?: unknown;
  angle?: unknown;
  service?: unknown;
  evidence?: unknown;
};

export function buildFollowUpCopy(companyName: string, contactName: string | null, angle: FollowUpAngle) {
  const title = text(angle.title);
  const service = text(angle.service);
  const evidence = Array.isArray(angle.evidence) ? text(angle.evidence[0]) : "";
  const idea = text(angle.angle);
  if (!title || !service || !evidence || !idea) return null;
  const greeting = contactName ? `Hi ${contactName.split(/\s+/)[0]},` : "Hi there,";
  return {
    subject: `A second idea for ${companyName}`.slice(0, 160),
    body: `${greeting}\n\nOne other angle from my review of ${companyName}: ${evidence} That makes ${title.toLowerCase()} a separate area worth testing, rather than assuming the first idea is the only lever.\n\nI would start with ${service.toLowerCase()}: ${idea} I can send a short outline of the first changes I would test.\n\nWould that be useful?\n\nBest,\nBamidele`,
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
