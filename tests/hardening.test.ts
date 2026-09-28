import { describe, expect, it } from "vitest";
import {
  canApproveOutreach,
  canDismissOutreach,
  onlyMatchingContact,
  outreachSendDecision,
  providerEventWrite,
  webhookTimestampFresh,
} from "@/lib/email/message-policy";
import { qualificationWritePlan, shouldStoreQualificationDraft } from "@/lib/research/evidence";
import { ACTIVE_JOB_STALE_MS, isPermanentJobError, JOB_HEARTBEAT_MS, jobDeliveryDecision, retryQueueJobId, shouldExecuteJob } from "@/lib/job-state";
import { QUOTA_LEASE_MS, releasePendingReservation, researchQuotaDecision, reserveAgainstCap, takeDailySlots } from "@/lib/campaign-quota";
import { inboundReplyDecision, inboundReplyId, prospectOutreachAfterBounce, webhookStateTransition } from "@/lib/email/message-policy";
import { routePublicBrowserTraffic } from "@/lib/research/public-browser";
import { isBlockedIp } from "@/lib/network";
import { GMAIL_STATE_PURPOSE } from "@/lib/email/gmail";

describe("outreach approval and send lock", () => {
  it("approves only a message that is waiting for review", () => {
    expect(canApproveOutreach("PENDING_APPROVAL")).toBe(true);
    expect(canApproveOutreach("DRAFT")).toBe(false);
    expect(canApproveOutreach("SENT")).toBe(false);
    expect(canApproveOutreach("OPENED")).toBe(false);
  });

  it("does not dismiss a message that has already been sent", () => {
    expect(canDismissOutreach("PENDING_APPROVAL")).toBe(true);
    expect(canDismissOutreach("APPROVED")).toBe(true);
    expect(canDismissOutreach("SENT")).toBe(false);
    expect(canDismissOutreach("OPENED")).toBe(false);
    expect(canDismissOutreach("SENDING")).toBe(false);
  });

  it("sends only approved work and treats opened mail as already sent", () => {
    expect(outreachSendDecision("APPROVED")).toBe("send");
    expect(outreachSendDecision("QUEUED")).toBe("send");
    expect(outreachSendDecision("FAILED")).toBe("do-not-resend");
    expect(outreachSendDecision("SENDING")).toBe("do-not-resend");
    expect(outreachSendDecision("DRAFT")).toBe("refuse");
    expect(outreachSendDecision("PENDING_APPROVAL")).toBe("refuse");
    expect(outreachSendDecision("CANCELLED")).toBe("refuse");
    expect(outreachSendDecision("SENT")).toBe("already-sent");
    expect(outreachSendDecision("OPENED")).toBe("already-sent");
    expect(outreachSendDecision("REPLIED")).toBe("already-sent");
  });
});

describe("provider webhooks", () => {
  it("refuses stale timestamps", () => {
    const now = Date.parse("2026-09-28T00:00:00Z");
    expect(webhookTimestampFresh(String(Math.floor(now / 1000)), now)).toBe(true);
    expect(webhookTimestampFresh(String(Math.floor(now / 1000) - 600), now)).toBe(false);
    expect(webhookTimestampFresh("nope", now)).toBe(false);
  });

  it("does not move a reply or an open backwards", () => {
    expect(providerEventWrite("email.delivered")?.from).toEqual(["SENT"]);
    expect(providerEventWrite("email.opened")?.from).toEqual(["SENT", "DELIVERED"]);
    expect(providerEventWrite("email.opened")?.from.includes("REPLIED")).toBe(false);
    expect(providerEventWrite("email.bounced")?.from.includes("REPLIED")).toBe(false);
    expect(providerEventWrite("email.bounced")?.state).toBe("FAILED");
    expect(webhookStateTransition("OPENED", "email.delivered")).toBe("OPENED");
    expect(webhookStateTransition("REPLIED", "email.opened")).toBe("REPLIED");
    expect(webhookStateTransition("FAILED", "email.delivered")).toBe("FAILED");
    expect(webhookStateTransition("SENT", "email.delivered")).toBe("DELIVERED");
    expect(webhookStateTransition("DELIVERED", "email.opened")).toBe("OPENED");
    expect(webhookStateTransition("OPENED", "email.bounced")).toBe("FAILED");
    expect(prospectOutreachAfterBounce("OPENED")).toBe("FAILED");
    expect(prospectOutreachAfterBounce("SENT")).toBe("FAILED");
    expect(prospectOutreachAfterBounce("REPLIED")).toBe("REPLIED");
    expect(prospectOutreachAfterBounce("DRAFT")).toBe("DRAFT");
    const eventId = "msg_123";
    expect(inboundReplyDecision([], eventId)).toBe("store");
    expect(inboundReplyDecision([inboundReplyId(eventId)], eventId)).toBe("duplicate");
    expect(inboundReplyDecision([inboundReplyId("msg_other")], eventId)).toBe("store");
  });

  it("attaches an inbound reply only when the sender matches one contact", () => {
    expect(onlyMatchingContact([{ organizationId: "a" }])?.organizationId).toBe("a");
    expect(onlyMatchingContact([])).toBeNull();
    expect(onlyMatchingContact([{ organizationId: "a" }, { organizationId: "b" }])).toBeNull();
  });
});

describe("job retries and research targets", () => {
  it("reclaims only a stale active claim and does not ack a live one", () => {
    const now = 1_000_000;
    expect(jobDeliveryDecision({ state: "QUEUED", attempts: 0, maxAttempts: 3, startedAtMs: null, nowMs: now })).toBe("run");
    expect(jobDeliveryDecision({ state: "COMPLETED", attempts: 1, maxAttempts: 3, startedAtMs: now, nowMs: now })).toBe("skip");
    expect(jobDeliveryDecision({
      state: "ACTIVE",
      attempts: 1,
      maxAttempts: 3,
      startedAtMs: now - 1_000,
      nowMs: now,
    })).toBe("busy");
    expect(jobDeliveryDecision({
      state: "ACTIVE",
      attempts: 1,
      maxAttempts: 3,
      startedAtMs: now - ACTIVE_JOB_STALE_MS,
      nowMs: now,
    })).toBe("reclaim");
    expect(jobDeliveryDecision({
      state: "ACTIVE",
      attempts: 3,
      maxAttempts: 3,
      startedAtMs: now - ACTIVE_JOB_STALE_MS,
      nowMs: now,
    })).toBe("exhausted");
    expect(jobDeliveryDecision({
      state: "ACTIVE",
      attempts: 1,
      maxAttempts: 3,
      startedAtMs: now - JOB_HEARTBEAT_MS,
      nowMs: now,
    })).toBe("busy");
    expect(JOB_HEARTBEAT_MS < ACTIVE_JOB_STALE_MS).toBe(true);
    expect(isPermanentJobError("Job is already active.")).toBe(false);
    expect(isPermanentJobError("Outreach sending is turned off. No email was sent.")).toBe(true);
    expect(isPermanentJobError("The daily research limit has been reached.")).toBe(true);
    expect(isPermanentJobError("The daily qualification quota has been reached.")).toBe(true);
    expect(isPermanentJobError("The daily discovery limit has been reached.")).toBe(true);
  });

  it("reserves one daily slot at a time and releases a failed research hold", () => {
    const now = 5_000_000;
    const first = reserveAgainstCap([], ["byron", "remax"], 2, now);
    expect(first.accepted).toEqual(["byron", "remax"]);
    const raced = reserveAgainstCap(first.records, ["another"], 2, now);
    expect(raced.accepted).toEqual([]);
    let used = 1;
    const claimed = takeDailySlots(used, 2, 1);
    used = claimed.usedAfter;
    expect(takeDailySlots(used, 2, 1).accepted).toBe(0);
    const held = [{ prospectId: "byron", fetchMethod: "pending", createdAtMs: now }];
    expect(researchQuotaDecision(held, 1, now)).toBe("stop");
    const released = held.filter((record) => releasePendingReservation(record.fetchMethod) === "keep");
    expect(researchQuotaDecision(released, 1, now)).toBe("allow");
    expect(researchQuotaDecision([{ prospectId: "byron", fetchMethod: "pending", createdAtMs: now - JOB_HEARTBEAT_MS }], 1, now)).toBe("stop");
    expect(researchQuotaDecision([{ prospectId: "byron", fetchMethod: "pending", createdAtMs: now - QUOTA_LEASE_MS }], 1, now)).toBe("allow");
    expect(researchQuotaDecision([{ prospectId: "byron", fetchMethod: "scrapy", createdAtMs: now - QUOTA_LEASE_MS }], 1, now)).toBe("stop");
    expect(QUOTA_LEASE_MS < 15 * 60 * 1000).toBe(true);
    expect(releasePendingReservation("scrapy")).toBe("keep");
  });

  it("does not run a finished job again", () => {
    expect(shouldExecuteJob("FAILED")).toBe(true);
    expect(shouldExecuteJob("QUEUED")).toBe(true);
    expect(shouldExecuteJob("ACTIVE")).toBe(false);
    expect(shouldExecuteJob("FAILED", 2, 3)).toBe(true);
    expect(shouldExecuteJob("FAILED", 3, 3)).toBe(false);
    expect(shouldExecuteJob("COMPLETED")).toBe(false);
    expect(shouldExecuteJob("CANCELLED")).toBe(false);
  });

  it("does not send again after a bounce or a provider failure", () => {
    expect(outreachSendDecision("FAILED")).toBe("do-not-resend");
    expect(outreachSendDecision("SENDING")).toBe("do-not-resend");
    expect(outreachSendDecision("SENT")).toBe("already-sent");
    expect(outreachSendDecision("APPROVED")).toBe("send");
  });

  it("skips a finished qualification instead of rewriting its evidence", () => {
    expect(qualificationWritePlan({ qualificationStatus: "QUALIFIED", assessmentCount: 3, messageStates: ["DRAFT"] })).toBe("skip");
    expect(qualificationWritePlan({ qualificationStatus: "QUALIFIED", assessmentCount: 3, messageStates: ["FAILED"] })).toBe("skip");
    expect(qualificationWritePlan({ qualificationStatus: "QUALIFIED", assessmentCount: 3, messageStates: ["CANCELLED"] })).toBe("write");
    expect(qualificationWritePlan({ qualificationStatus: "UNREVIEWED", assessmentCount: 0, messageStates: [] })).toBe("write");
    expect(shouldStoreQualificationDraft(["DRAFT"])).toBe(false);
    expect(shouldStoreQualificationDraft(["FAILED"])).toBe(false);
    expect(shouldStoreQualificationDraft([])).toBe(true);
  });

  it("uses a new queue id when a failed job is retried", () => {
    expect(retryQueueJobId("job-1", 2)).toBe("job-1:retry:2");
    expect(retryQueueJobId("job-1", 2)).not.toBe("job-1");
  });

  it("blocks IPv4 addresses hidden inside IPv6", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:10.1.1.1")).toBe(true);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("routes browser traffic through the pinned fetch and closes sockets", async () => {
    const fulfilled: number[] = [];
    const closed: string[] = [];
    const page = {
      async route(_pattern: string, handler: (route: { request: () => { url: () => string }; fulfill: (value: { status: number }) => Promise<void>; abort: () => Promise<void> }) => Promise<void>) {
        await handler({
          request: () => ({ url: () => "http://public.example/" }),
          fulfill: async (value) => { fulfilled.push(value.status); },
          abort: async () => { fulfilled.push(0); },
        });
      },
      async routeWebSocket(_pattern: string, handler: (socket: { close: () => void }) => void) {
        handler({ close: () => { closed.push("closed"); } });
      },
    };
    await routePublicBrowserTraffic(page as never, async () => ({ url: "http://public.example/", status: 200, headers: {}, body: Buffer.from("ok") }));
    expect(fulfilled).toEqual([200]);
    expect(closed).toEqual(["closed"]);
  });

  it("names the Gmail state purpose", () => {
    expect(GMAIL_STATE_PURPOSE).toBe("gmail-connect");
  });
});
