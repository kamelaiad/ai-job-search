import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// Every case here fails during argument validation, before any request.
async function expectError(args: string[], code: string, message?: RegExp): Promise<void> {
  const result = await runCLI(args);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const err = JSON.parse(result.stderr);
  expect(err.code).toBe(code);
  expect(typeof err.error).toBe("string");
  if (message) expect(err.error).toMatch(message);
}

describe("Techcareer CLI error contract", () => {
  test("a bogus flag exits 1 with a JSON error on stderr", async () => {
    await expectError(["search", "-q", "frontend", "--bogus", "1"], "UNKNOWN_FLAG", /--bogus/);
  });

  test("--jobage is refused, not silently dropped", async () => {
    await expectError(["search", "-q", "frontend", "--jobage", "7"], "UNSUPPORTED_FLAG", /jobage/);
    await expectError(["search", "-q", "frontend", "--jobage-minutes", "30"], "UNSUPPORTED_FLAG", /jobage/);
  });

  test("detail without an id exits 1", async () => {
    await expectError(["detail"], "NO_ID");
  });

  test("detail with an id that is not a Techcareer slug exits 1", async () => {
    await expectError(["detail", "https://evil.io/jobs/detail/back-end-developer-4491449"], "BAD_ID");
  });

  test("an empty or bare --query / --location exits 1 instead of listing everything", async () => {
    await expectError(["search", "-q", ""], "BAD_ARG", /query/);
    await expectError(["search", "-q"], "BAD_ARG", /query/);
    await expectError(["search", "-l", "  "], "BAD_ARG", /location/);
  });

  for (const name of ["page", "limit"]) {
    for (const value of ["0", "1.5", "abc"]) {
      test(`--${name} ${value} exits 1 with BAD_ARG`, async () => {
        await expectError(["search", "-q", "frontend", `--${name}`, value], "BAD_ARG", new RegExp(name));
      });
    }
  }

  test("an unknown --format exits 1", async () => {
    await expectError(["search", "-q", "frontend", "--format", "xml"], "BAD_ARG", /format/);
    await expectError(["detail", "back-end-developer-4491449", "--format", "table"], "BAD_ARG", /format/);
  });

  test("an unknown command exits 1", async () => {
    await expectError(["apply"], "BAD_CMD");
  });

  test("--help prints usage on stdout and exits 0", async () => {
    const result = await runCLI(["search", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("techcareer-cli");
  });
});
