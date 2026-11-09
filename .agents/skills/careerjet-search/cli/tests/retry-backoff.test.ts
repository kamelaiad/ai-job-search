import { afterEach, describe, expect, test } from "bun:test";
import { apiFetch } from "../src/helpers";

// The portal contract requires backoff on 429/5xx. These tests pin the retry
// loop offline: a stubbed fetch counts attempts, and a stubbed setTimeout
// fires immediately so the exhaustion case does not sleep through the real
// 500ms -> 8s backoff schedule.

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const URL_ = "https://search.api.careerjet.net/v4/query?locale_code=tr_TR";

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

function instantTimers() {
  globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as unknown as typeof setTimeout;
}

function stubFetch(responses: Array<() => Response>): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    const i = Math.min(state.calls, responses.length - 1);
    state.calls++;
    return responses[i]();
  }) as unknown as typeof fetch;
  return state;
}

describe("apiFetch retry/backoff", () => {
  test("retries a 429 and succeeds on the next attempt", async () => {
    instantTimers();
    const state = stubFetch([
      () => new Response("", { status: 429 }),
      () => new Response('{"type":"JOBS","jobs":[]}', { status: 200 }),
    ]);
    expect(await apiFetch(URL_, "t")).toEqual({ type: "JOBS", jobs: [] });
    expect(state.calls).toBe(2);
  });

  test("returns null on 404 without retrying", async () => {
    const state = stubFetch([() => new Response("", { status: 404 })]);
    expect(await apiFetch(URL_, "t")).toBeNull();
    expect(state.calls).toBe(1);
  });

  test("gives up after the initial attempt plus six retries on persistent 5xx", async () => {
    instantTimers();
    const state = stubFetch([() => new Response("", { status: 503 })]);
    await expect(apiFetch(URL_, "t")).rejects.toThrow(/503/);
    expect(state.calls).toBe(7);
  });

  test("does not retry a 401: it throws AUTH_FAILED with the API's message", async () => {
    const state = stubFetch([
      () => new Response('{"error":"Invalid API key provided","type":"ERROR"}', { status: 401 }),
    ]);
    await expect(apiFetch(URL_, "t")).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect(state.calls).toBe(1);
  });

  test("a 400 surfaces the API's message as API_ERROR", async () => {
    stubFetch([() => new Response('{"error":"Unsupported locale code","type":"ERROR"}', { status: 400 })]);
    await expect(apiFetch(URL_, "t")).rejects.toThrow(/Unsupported locale code/);
  });
});
