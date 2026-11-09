import { afterEach, describe, expect, test } from "bun:test";
import { htmlFetch, pageFetch } from "../src/helpers";

// The portal contract requires backoff on 429/5xx, a timeout, null/"" on 404,
// and an honest stop on bot protection. A stubbed fetch counts attempts, and a
// stubbed setTimeout fires immediately so the exhaustion case does not sleep
// through the real 500ms -> 8s backoff schedule.

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function instantTimers() {
  globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as unknown as typeof setTimeout;
}

function stubFetch(responses: Array<() => Response>): { calls: number; init: RequestInit[] } {
  const state = { calls: 0, init: [] as RequestInit[] };
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const i = Math.min(state.calls, responses.length - 1);
    state.calls++;
    state.init.push(init ?? {});
    return responses[i]();
  }) as unknown as typeof fetch;
  return state;
}

const URL_ = "https://www.kariyer.net/is-ilanlari?kw=x";

describe("pageFetch retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response("<html>ok</html>", { status: 200 }),
    ]);
    expect(await htmlFetch(URL_)).toContain("ok");
    expect(state.calls).toBe(2);
  });

  test("returns null / empty string on 404 without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 404 })]);
    expect(await pageFetch(URL_)).toBeNull();
    expect(await htmlFetch(URL_)).toBe("");
    expect(state.calls).toBe(2);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("", { status: 503 })]);
    await expect(htmlFetch(URL_)).rejects.toThrow(/503/);
    expect(state.calls).toBe(7);
  });
});

describe("pageFetch request hygiene", () => {
  test("sends the honest kariyer-cli User-Agent and a timeout signal", async () => {
    const state = stubFetch([() => new Response("<html></html>", { status: 200 })]);
    await pageFetch(URL_);
    const headers = state.init[0].headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("Mozilla/5.0 (compatible; kariyer-cli/1.0)");
    expect(state.init[0].signal).toBeInstanceOf(AbortSignal);
  });

  test("a 403 is BLOCKED and is not retried", async () => {
    const state = stubFetch([() => new Response("denied", { status: 403 })]);
    await expect(pageFetch(URL_)).rejects.toMatchObject({ code: "BLOCKED" });
    expect(state.calls).toBe(1);
  });

  test("a bot-protection challenge page served with 200 is BLOCKED", async () => {
    stubFetch([() => new Response('<html><div id="px-captcha"></div></html>', { status: 200 })]);
    await expect(pageFetch(URL_)).rejects.toMatchObject({ code: "BLOCKED" });
  });

  test("the normal page's sensor script alone is not mistaken for a challenge", async () => {
    stubFetch([() => new Response('<script src="//client.px-cloud.net/PX1/main.min.js"></script>', { status: 200 })]);
    expect(await htmlFetch(URL_)).toContain("px-cloud");
  });
});
