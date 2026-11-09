// Argument validation: every bad invocation exits 1 with a JSON error on stderr
// and nothing on stdout, before any request is made.
import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

async function expectError(args: string[], code: string): Promise<{ error: string; code: string }> {
  const result = await runCLI(args);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  const err = JSON.parse(result.stderr);
  expect(typeof err.error).toBe("string");
  expect(err.code).toBe(code);
  return err;
}

describe("iskur CLI error contract", () => {
  test("a bogus flag is rejected, never ignored", async () => {
    const err = await expectError(["search", "-q", "grafik", "--bogus", "1"], "UNKNOWN_FLAG");
    expect(err.error).toContain("--bogus");
  });

  test("--remote is not an İŞKUR filter and is rejected", async () => {
    await expectError(["search", "-q", "grafik", "--remote", "remote"], "UNKNOWN_FLAG");
  });

  test("empty or bare --query is rejected", async () => {
    await expectError(["search", "-q", ""], "BAD_ARG");
    await expectError(["search", "-q"], "BAD_ARG");
  });

  test("unknown province is rejected", async () => {
    await expectError(["search", "-q", "grafik", "-l", "Berlin"], "UNKNOWN_LOCATION");
  });

  test("bad --sector is rejected", async () => {
    await expectError(["search", "-q", "grafik", "--sector", "both"], "BAD_ARG");
  });

  for (const name of ["jobage", "page", "limit"]) {
    test(`--${name} must be a whole number >= 1`, async () => {
      await expectError(["search", "-q", "grafik", `--${name}`, "1.5"], "BAD_ARG");
      await expectError(["search", "-q", "grafik", `--${name}`, "0"], "BAD_ARG");
      await expectError(["search", "-q", "grafik", `--${name}`, "abc"], "BAD_ARG");
    });
  }

  test("bad --format is rejected", async () => {
    await expectError(["search", "-q", "grafik", "--format", "xml"], "BAD_ARG");
    await expectError(["detail", "00009887102", "--format", "table"], "BAD_ARG");
  });

  test("detail without an id", async () => {
    await expectError(["detail"], "NO_ID");
  });

  test("detail with a foreign URL is rejected before any request", async () => {
    await expectError(["detail", "https://example.com/Istihdam/AcikIsIlanDetay.aspx?uiID=00009887102"], "BAD_ID");
  });

  test("unknown command", async () => {
    await expectError(["apply"], "BAD_CMD");
  });

  test("--help prints usage and exits 0", async () => {
    const result = await runCLI(["search", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("iskur-cli");
  });
});
