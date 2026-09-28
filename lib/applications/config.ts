import type { ApplicationMode } from "@/lib/applications/types";

export function applicationAutomationEnabled() {
  return process.env.APPLICATION_AUTOMATION_ENABLED === "true";
}

export function jobDiscoveryEnabled() {
  return process.env.JOB_DISCOVERY_ENABLED === "true";
}

export function cvGenerationEnabled() {
  return process.env.CV_GENERATION_ENABLED !== "false";
}

export function coverLetterGenerationEnabled() {
  return process.env.COVER_LETTER_GENERATION_ENABLED !== "false";
}

export function applicationMode(): ApplicationMode {
  const mode = process.env.APPLICATION_MODE;
  if (mode === "MANUAL" || mode === "AUTO_SUBMIT" || mode === "AUTO_PREPARE") return mode;
  return "AUTO_PREPARE";
}

export function applicationDailyTarget() {
  const value = Number(process.env.APPLICATION_DAILY_TARGET ?? 500);
  if (!Number.isFinite(value) || value < 1) return 500;
  return Math.min(Math.floor(value), 500);
}

export function applicationWorkerConcurrency() {
  const value = Number(process.env.APPLICATION_WORKER_CONCURRENCY ?? 2);
  if (!Number.isFinite(value) || value < 1) return 2;
  return Math.min(Math.floor(value), 4);
}

export function applicationDomainConcurrency() {
  const value = Number(process.env.APPLICATION_DOMAIN_CONCURRENCY ?? 1);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), 2);
}

export function applicationMaxRetries() {
  const value = Number(process.env.APPLICATION_MAX_RETRIES ?? 3);
  if (!Number.isFinite(value) || value < 1) return 3;
  return Math.min(Math.floor(value), 3);
}

export function applicationTimeoutMs() {
  const value = Number(process.env.APPLICATION_TIMEOUT_MS ?? 120_000);
  if (!Number.isFinite(value) || value < 5_000) return 120_000;
  return Math.min(Math.floor(value), 120_000);
}
