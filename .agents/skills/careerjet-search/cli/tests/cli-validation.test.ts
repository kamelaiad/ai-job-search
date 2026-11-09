import { afterAll, describe, expect, test } from "bun:test";
import { parseStderr, runCLI, runWithStubApi, tempCache } from "./helpers";
import { searchResponse } from "./fixtures/search-response";

const cache = tempCache();
afterAll(() => cache.cleanup());

async function expectError(args: string[], code: string, env: Record<string, string> = {}) {
  const result = await runCLI(args, { env: { CAREERJET_CACHE_FILE: cache.file, ...env } });
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const err = parseStderr(result);
  expect(err.code).toBe(code);
  expect(typeof err.error).toBe("string");
  return err;
}

describe("contract: errors are JSON on stderr with exit 1", () => {
  test("a bogus flag is rejected, not ignored", async () => {
    const err = await expectError(["search", "-q", "web developer", "--bogus", "1"], "UNKNOWN_FLAG", {
      CAREERJET_API_TOKEN: "test-token",
    });
    expect(err.error).toMatch(/--bogus/);
  });

  test("detail without an id exits 1 with NO_ID", async () => {
    await expectError(["detail"], "NO_ID");
  });

  test("detail with an unparseable id exits 1 with BAD_ID", async () => {
    await expectError(["detail", "12345"], "BAD_ID");
  });

  test("detail for an id not in the cache exits 1 with NOT_FOUND", async () => {
    await expectError(["detail", "cj-0123456789abcdef"], "NOT_FOUND");
  });

  test("unknown command exits 1 with BAD_CMD", async () => {
    await expectError(["frobnicate"], "BAD_CMD");
  });
});

describe("credentials", () => {
  test("missing CAREERJET_API_TOKEN exits 1 with MISSING_CREDENTIALS and makes no request", async () => {
    const { result, requests } = await runWithStubApi(["search", "-q", "web developer", "-l", "Bursa"], {
      response: searchResponse(),
      token: undefined,
      cacheFile: cache.file,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    const err = parseStderr(result);
    expect(err.code).toBe("MISSING_CREDENTIALS");
    expect(err.error).toContain("CAREERJET_API_TOKEN");
    expect(requests).toHaveLength(0);
  });

  test("a blank CAREERJET_API_TOKEN counts as unset", async () => {
    await expectError(["search", "-q", "web developer"], "MISSING_CREDENTIALS", { CAREERJET_API_TOKEN: "   " });
  });

  test("a rejected key surfaces as AUTH_FAILED with the API's message", async () => {
    const { result } = await runWithStubApi(["search", "-q", "web developer"], {
      response: { error: "Invalid API key provided", type: "ERROR" },
      status: 401,
      token: "wrong",
      cacheFile: cache.file,
    });
    expect(result.exitCode).toBe(1);
    const err = parseStderr(result);
    expect(err.code).toBe("AUTH_FAILED");
    expect(err.error).toContain("Invalid API key provided");
  });
});

describe("flag validation", () => {
  const env = { CAREERJET_API_TOKEN: "test-token" };
  const cases: Array<[string, string[]]> = [
    ["empty --query", ["search", "-q", ""]],
    ["bare --query", ["search", "-q"]],
    ["empty --location", ["search", "-q", "x", "-l", " "]],
    ["--page above the API's 10-page limit", ["search", "-q", "x", "--page", "11"]],
    ["--page 0", ["search", "-q", "x", "--page", "0"]],
    ["fractional --jobage", ["search", "-q", "x", "--jobage", "0.5"]],
    ["non-numeric --limit", ["search", "-q", "x", "--limit", "ten"]],
    ["unknown --contract", ["search", "-q", "x", "--contract", "freelance"]],
    ["unknown --hours", ["search", "-q", "x", "--hours", "half"]],
    ["unknown --sort", ["search", "-q", "x", "--sort", "newest"]],
    ["unknown --format", ["search", "-q", "x", "--format", "csv"]],
    ["table format on detail", ["detail", "cj-0123456789abcdef", "--format", "table"]],
  ];
  for (const [name, args] of cases) {
    test(`${name} exits 1 with BAD_ARG`, async () => {
      await expectError(args, "BAD_ARG", env);
    });
  }

  test("--help prints usage and exits 0", async () => {
    const result = await runCLI(["search", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CAREERJET_API_TOKEN");
  });
});
