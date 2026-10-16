import { afterEach, describe, expect, it } from "vitest";
import { applicationLiveSubmitEnabled, applicationMode } from "@/lib/applications/config";
import { configuredBoards } from "@/lib/applications/job-sources";

const saved = { mode: process.env.APPLICATION_MODE, live: process.env.APPLICATION_LIVE_SUBMIT };
afterEach(() => {
  if (saved.mode === undefined) delete process.env.APPLICATION_MODE;
  else process.env.APPLICATION_MODE = saved.mode;
  if (saved.live === undefined) delete process.env.APPLICATION_LIVE_SUBMIT;
  else process.env.APPLICATION_LIVE_SUBMIT = saved.live;
});

describe("application submission defaults", () => {
  it("prepares applications and does not submit when nothing is configured", () => {
    delete process.env.APPLICATION_MODE;
    delete process.env.APPLICATION_LIVE_SUBMIT;
    expect(applicationMode()).toBe("AUTO_PREPARE");
    expect(applicationLiveSubmitEnabled()).toBe(false);
  });

  it("treats anything but the exact value true as live submit off", () => {
    process.env.APPLICATION_LIVE_SUBMIT = "yes";
    expect(applicationLiveSubmitEnabled()).toBe(false);
    process.env.APPLICATION_LIVE_SUBMIT = "true";
    expect(applicationLiveSubmitEnabled()).toBe(true);
  });
});

describe("job board configuration", () => {
  it("uses the built-in boards when JOB_BOARDS is empty or invalid", () => {
    expect(configuredBoards("").length).toBeGreaterThan(5);
    expect(configuredBoards("nonsense,foo:bar baz").length).toBeGreaterThan(5);
  });

  it("parses a valid JOB_BOARDS list and skips bad entries", () => {
    expect(configuredBoards("greenhouse:GitLab, lever:spotify, bogus:x, ashby:bad/slug")).toEqual([
      { source: "greenhouse", board: "gitlab" },
      { source: "lever", board: "spotify" },
    ]);
  });
});
