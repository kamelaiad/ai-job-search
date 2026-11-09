import { describe, expect, test } from "bun:test";
import { runCLI } from "./helpers";

// Every case here fails during argument validation, before any request.

function err(stderr: string): { error?: string; code?: string } {
  return JSON.parse(stderr);
}

describe("kariyer CLI error contract", () => {
  test("a bogus flag exits 1 with UNKNOWN_FLAG JSON on stderr and nothing on stdout", async () => {
    const r = await runCLI(["search", "-q", "web developer", "--city", "Bursa"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(err(r.stderr).code).toBe("UNKNOWN_FLAG");
  });

  test("search without --query or --location exits 1 with MISSING_REQUIRED", async () => {
    const r = await runCLI(["search", "--jobage", "7"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(err(r.stderr).code).toBe("MISSING_REQUIRED");
  });

  test("a bare or empty --query is BAD_ARG, not an unfiltered search", async () => {
    for (const args of [["search", "-q"], ["search", "-q", "  "], ["search", "-l", "Bursa", "-q"]]) {
      const r = await runCLI(args);
      expect(r.exitCode).toBe(1);
      expect(err(r.stderr).code).toBe("BAD_ARG");
    }
  });

  test("an unknown --location is BAD_ARG, not a nationwide search", async () => {
    const r = await runCLI(["search", "-q", "web developer", "-l", "Berlin"]);
    expect(r.exitCode).toBe(1);
    expect(err(r.stderr)).toMatchObject({ code: "BAD_ARG" });
    expect(err(r.stderr).error).toMatch(/location/);
  });

  for (const name of ["jobage", "page", "limit"]) {
    for (const value of ["0", "1.5", "abc"]) {
      test(`--${name} ${value} exits 1 with BAD_ARG`, async () => {
        const r = await runCLI(["search", "-q", "x", `--${name}`, value]);
        expect(r.exitCode).toBe(1);
        expect(err(r.stderr).code).toBe("BAD_ARG");
        expect(err(r.stderr).error).toMatch(new RegExp(name));
      });
    }
  }

  test("--remote with an unknown mode exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "-q", "x", "--remote", "uzaktan"]);
    expect(r.exitCode).toBe(1);
    expect(err(r.stderr).code).toBe("BAD_ARG");
  });

  test("--format must be a supported format", async () => {
    const r = await runCLI(["search", "-q", "x", "--format", "csv"]);
    expect(r.exitCode).toBe(1);
    expect(err(r.stderr).code).toBe("BAD_ARG");
  });

  test("detail without an id exits 1 with NO_ID", async () => {
    const r = await runCLI(["detail"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(err(r.stderr).code).toBe("NO_ID");
  });

  test("detail with a foreign URL exits 1 with BAD_ID", async () => {
    const r = await runCLI(["detail", "https://example.com/jobs/4520391"]);
    expect(r.exitCode).toBe(1);
    expect(err(r.stderr).code).toBe("BAD_ID");
  });

  test("an unknown command exits 1 with BAD_CMD", async () => {
    const r = await runCLI(["apply", "4520391"]);
    expect(r.exitCode).toBe(1);
    expect(err(r.stderr).code).toBe("BAD_CMD");
  });

  test("search --help prints usage and exits 0", async () => {
    const r = await runCLI(["search", "--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("kariyer-cli");
  });
});
