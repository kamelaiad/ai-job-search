import { afterEach, describe, expect, test } from "bun:test";
import { normalizeId, runDetail } from "../src/commands/detail";
import { detailPage } from "./fixtures";

// `detail` must never fetch a posting for a URL that is not a kariyer.net
// posting. fetch is stubbed throughout; no test here touches the network.

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

function recordingFetch(respond: () => Response): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return respond();
  }) as unknown as typeof fetch;
  return requested;
}

function capture(stream: "stdout" | "stderr"): string[] {
  const out: string[] = [];
  process[stream].write = ((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return out;
}

describe("normalizeId", () => {
  test("accepts IDs, posting URLs and slugs", () => {
    expect(normalizeId("4520391")).toBe("4520391");
    expect(normalizeId("https://www.kariyer.net/is-ilani/ornek-yazilim-web-developer-4520391")).toBe("4520391");
    expect(normalizeId("kariyer.net/is-ilani/ornek-yazilim-web-developer-4520391")).toBe("4520391");
    expect(normalizeId("https://www.kariyer.net/is-ilani/4520391")).toBe("4520391");
    expect(normalizeId("ornek-yazilim-web-developer-4520391")).toBe("4520391");
  });

  test("rejects other hosts, look-alikes and non-posting paths", () => {
    expect(normalizeId("https://boards.greenhouse.io/acme/jobs/4520391")).toBeNull();
    expect(normalizeId("https://www.kariyer.net.evil.io/is-ilani/x-4520391")).toBeNull();
    expect(normalizeId("https://www.kariyer.net@evil.io/is-ilani/x-4520391")).toBeNull();
    expect(normalizeId("https://www.kariyer.net/firma-profil/ornek-105932-451429")).toBeNull();
    expect(normalizeId("hello")).toBeNull();
  });
});

describe("runDetail", () => {
  test("a foreign URL is rejected with BAD_ID before any request", async () => {
    const requested = recordingFetch(() => new Response("", { status: 404 }));
    const stderr = capture("stderr");
    expect(await runDetail({ id: "https://boards.greenhouse.io/acme/jobs/4520391", format: "json" })).toBe(1);
    expect(requested).toEqual([]);
    expect(JSON.parse(stderr.join("").trim())).toMatchObject({ code: "BAD_ID" });
  });

  test("fetches /is-ilani/<id> and prints the posting", async () => {
    const requested = recordingFetch(() => new Response(detailPage(), { status: 200 }));
    const stdout = capture("stdout");
    expect(await runDetail({ id: "https://www.kariyer.net/is-ilani/ornek-web-developer-4520391", format: "json" })).toBe(0);
    expect(requested).toEqual(["https://www.kariyer.net/is-ilani/4520391"]);
    const job = JSON.parse(stdout.join(""));
    expect(job).toMatchObject({ id: "4520391", title: "Web Developer", deadline: "2026-12-05" });
  });

  test("a 404 is NOT_FOUND on stderr with exit 1", async () => {
    recordingFetch(() => new Response("", { status: 404 }));
    const stderr = capture("stderr");
    expect(await runDetail({ id: "4520391", format: "json" })).toBe(1);
    expect(JSON.parse(stderr.join("").trim())).toMatchObject({ code: "NOT_FOUND" });
  });

  test("a redirect to the job list (unknown or removed ID) is NOT_FOUND", async () => {
    globalThis.fetch = (async () => {
      const res = new Response("<html>liste</html>", { status: 200 });
      Object.defineProperty(res, "url", { value: "https://www.kariyer.net/is-ilanlari" });
      return res;
    }) as unknown as typeof fetch;
    const stderr = capture("stderr");
    expect(await runDetail({ id: "1234567", format: "json" })).toBe(1);
    expect(JSON.parse(stderr.join("").trim())).toMatchObject({ code: "NOT_FOUND" });
  });
});
