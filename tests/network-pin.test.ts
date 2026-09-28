import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { exchangePinned, fetchPublic, isBlockedIp, selectPublicAddresses } from "@/lib/network";

const execFileAsync = promisify(execFile);

describe("public address policy", () => {
  it("blocks local ranges and allows ordinary public addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.1.1",
      "172.16.0.4",
      "192.168.1.9",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "0:0:0:0:0:0:0:1",
      "fe80::1",
      "febf::1",
      "fc00::1",
      "fd12::1",
      "fec0::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:a00:1",
      "::ffff:169.254.169.254",
      "192.0.0.8",
      "192.0.2.10",
      "198.18.0.1",
      "198.51.100.10",
      "203.0.113.10",
      "::7f00:1",
      "2001:db8::1",
      "2001:0:1::1",
      "2002:7f00:1::1",
    ]) {
      expect(isBlockedIp(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "1.1.1.1", "207.180.248.233", "198.51.50.1", "::ffff:8.8.8.8"]) {
      expect(isBlockedIp(address), address).toBe(false);
    }
    expect(selectPublicAddresses(["207.180.248.233"])).toEqual(["207.180.248.233"]);
    expect(() => selectPublicAddresses(["8.8.8.8", "127.0.0.1"])).toThrow(/private/);
  });
});

describe("pinned research fetches", () => {
  it("refuses an unsafe address even when the pinned transport is called directly", async () => {
    expect(() => exchangePinned({ url: new URL("http://public.example/"), address: "127.0.0.1" })).toThrow(/private/);
  });

  it("does not connect when DNS returns a private, loopback, or mapped address", async () => {
    let exchanges = 0;
    const exchange = async () => {
      exchanges += 1;
      return { status: 200, headers: {}, body: Buffer.from("nope") };
    };
    for (const address of ["127.0.0.1", "10.0.0.8", "169.254.169.254", "fe80::1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      await expect(fetchPublic("http://public.example/", {
        resolve: async () => [address],
        exchange,
      })).rejects.toThrow(/private|not a public/);
    }
    expect(exchanges).toBe(0);
  });

  it("does not follow a redirect or a subresource onto a private address", async () => {
    const calls: string[] = [];
    await expect(fetchPublic("http://public.example/start", {
      resolve: async (hostname) => (hostname === "public.example" ? ["8.8.8.8"] : ["10.9.9.9"]),
      exchange: async ({ url, address }) => {
        calls.push(`${address} ${url.pathname}`);
        return { status: 302, headers: { location: "http://intranet.example/secret" }, body: Buffer.alloc(0) };
      },
    })).rejects.toThrow(/private/);
    await expect(fetchPublic("http://cdn.example/app.js", {
      resolve: async () => ["::ffff:10.1.1.1"],
      exchange: async () => {
        calls.push("subresource");
        return { status: 200, headers: {}, body: Buffer.from("js") };
      },
    })).rejects.toThrow(/private/);
    expect(calls).toEqual(["8.8.8.8 /start"]);
  });
});

describe("scrapy address pin", () => {
  it("rejects private targets and keeps a public address", async () => {
    const script = `
import json
from pin import choose_address, is_blocked_ip
samples = ["127.0.0.1","10.0.0.1","169.254.169.254","::1","fe80::1","fc00::1","fd00::1","::ffff:127.0.0.1","::ffff:7f00:1","192.0.0.8","192.0.2.1","198.18.0.1","198.51.100.1","203.0.113.1","2001:db8::1","2001:0:1::1","2002:7f00:1::1","8.8.8.8","207.180.248.233"]
print(json.dumps({
  "blocked": {item: is_blocked_ip(item) for item in samples},
  "mixed": "raise",
}))
try:
    choose_address(["8.8.8.8", "10.0.0.1"])
except ValueError:
    pass
else:
    raise SystemExit("mixed addresses were accepted")
`;
    const { stdout } = await execFileAsync("/tmp/pp-crawl-venv/bin/python", ["-c", script], { cwd: "crawler" });
    const parsed = JSON.parse(stdout) as { blocked: Record<string, boolean> };
    expect(parsed.blocked["8.8.8.8"]).toBe(false);
    expect(parsed.blocked["207.180.248.233"]).toBe(false);
    expect(parsed.blocked["127.0.0.1"]).toBe(true);
    expect(parsed.blocked["::ffff:7f00:1"]).toBe(true);
    expect(parsed.blocked["fe80::1"]).toBe(true);
    expect(parsed.blocked["fc00::1"]).toBe(true);
    for (const address of ["192.0.0.8", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "2001:db8::1", "2001:0:1::1", "2002:7f00:1::1"]) {
      expect(parsed.blocked[address], address).toBe(true);
    }
  });
});
