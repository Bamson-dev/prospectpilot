export function healthDecision(database: "up" | "down", redis: "up" | "down" | "unconfigured", ready: boolean) {
  const degraded = database !== "up" || (ready && redis === "down");
  return {
    ok: !degraded,
    status: degraded ? 503 : 200,
    body: { ok: !degraded, service: "prospectpilot", database, redis },
  };
}
