import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// Every case here fails validation before any request is made - no network.

function stderrJSON(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

async function expectError(args: string[], code: string): Promise<void> {
  const result = await runCLI(args);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const err = stderrJSON(result.stderr);
  expect(typeof err.error).toBe("string");
  expect(err.code).toBe(code);
}

describe("CLI error contract (stderr JSON, exit 1)", () => {
  test("a bogus flag is rejected, not ignored", () => expectError(["search", "-q", "designer", "--salary", "100k"], "UNKNOWN_FLAG"));
  test("detail rejects search-only flags", () => expectError(["detail", "311562", "--remote"], "UNKNOWN_FLAG"));
  test("detail without an id", () => expectError(["detail"], "NO_ID"));
  test("detail with a non-Dribbble URL", () =>
    expectError(["detail", "https://boards.example.com/jobs/311562"], "BAD_ID"));
  test("detail with a look-alike host", () =>
    expectError(["detail", "https://dribbble.com.example.io/jobs/311562"], "BAD_ID"));
  test("unknown command", () => expectError(["serach", "-q", "designer"], "BAD_CMD"));
  test("empty --query", () => expectError(["search", "-q", ""], "BAD_ARG"));
  test("bare --query", () => expectError(["search", "-q"], "BAD_ARG"));
  test("empty --location", () => expectError(["search", "-l", "  "], "BAD_ARG"));
  test("--remote takes no value", () => expectError(["search", "--remote", "yes"], "BAD_ARG"));
  test("unknown --specialty", () => expectError(["search", "--specialty", "ui,typography"], "BAD_ARG"));
  test("unknown --type", () => expectError(["search", "--type", "parttime"], "BAD_ARG"));
  test("bad --format", () => expectError(["search", "--format", "csv"], "BAD_ARG"));
  test("detail rejects --format table", () => expectError(["detail", "311562", "--format", "table"], "BAD_ARG"));
  test("stray positional search argument", () => expectError(["search", "product", "designer"], "BAD_ARG"));
  for (const name of ["jobage", "page", "limit"]) {
    test(`--${name} fractional is rejected, not truncated`, () => expectError(["search", `--${name}`, "1.5"], "BAD_ARG"));
    test(`--${name} 0 is rejected`, () => expectError(["search", `--${name}`, "0"], "BAD_ARG"));
    test(`--${name} non-numeric is rejected`, () => expectError(["search", `--${name}`, "ten"], "BAD_ARG"));
  }
});

describe("help", () => {
  test("search --help prints usage to stdout and exits 0", async () => {
    const result = await runCLI(["search", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("USAGE");
  });
});
