import { afterEach, describe, expect, test } from "bun:test";
import { htmlFetch } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. A stubbed fetch counts
// attempts, and a stubbed setTimeout fires immediately so the exhaustion case
// does not sleep through the real 500ms -> 8s backoff schedule.

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function instantTimers() {
  globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as unknown as typeof setTimeout;
}

function stubFetch(responses: Array<() => Response>): { calls: number; userAgent: string | null } {
  const state = { calls: 0, userAgent: null as string | null };
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    state.userAgent = new Headers(init?.headers).get("User-Agent");
    const i = Math.min(state.calls, responses.length - 1);
    state.calls++;
    return responses[i]();
  }) as unknown as typeof fetch;
  return state;
}

describe("htmlFetch", () => {
  test("sends the honest tool User-Agent", async () => {
    const state = stubFetch([() => new Response("ok")]);
    await htmlFetch("https://www.techcareer.net/jobs");
    expect(state.userAgent).toBe("Mozilla/5.0 (compatible; techcareer-cli/1.0)");
  });

  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("", { status: 429 }), () => new Response("<html>ok</html>")]);
    expect(await htmlFetch("https://www.techcareer.net/jobs")).toContain("ok");
    expect(state.calls).toBe(2);
  });

  test("returns an empty string on 404 without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 404 })]);
    expect(await htmlFetch("https://www.techcareer.net/jobs")).toBe("");
    expect(state.calls).toBe(1);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("", { status: 503 })]);
    await expect(htmlFetch("https://www.techcareer.net/jobs")).rejects.toThrow(/503/);
    expect(state.calls).toBe(7);
  });

  test("a 403 fails at once instead of retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 403 })]);
    await expect(htmlFetch("https://www.techcareer.net/jobs")).rejects.toThrow(/403/);
    expect(state.calls).toBe(1);
  });
});
