import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  /** Extra/overriding environment variables; `undefined` removes a variable. */
  env?: Record<string, string | undefined>;
  /** A module preloaded into the CLI process (used to redirect fetch offline). */
  preload?: string;
}

/** The parent environment without any Careerjet settings, plus `extra`. */
function childEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("CAREERJET_")) env[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

export async function runCLI(args: string[], opts: RunOptions = {}): Promise<CLIResult> {
  const proc = Bun.spawn(
    ["bun", "run", ...(opts.preload ? ["--preload", opts.preload] : []), CLI_PATH, ...args],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: childEnv(opts.env),
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) {
    throw new Error(
      `CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`
    );
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(
      `Failed to parse JSON. stdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
}

export function parseStderr(result: CLIResult): { error?: string; code?: string } {
  try {
    return JSON.parse(result.stderr);
  } catch {
    return {};
  }
}

export interface CapturedRequest {
  url: URL;
  authorization: string | null;
  userAgent: string | null;
}

/** A temp dir holding an isolated cache file, so tests never touch the real one. */
export function tempCache(): { dir: string; file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "careerjet-test-cache-"));
  return { dir, file: join(dir, "cache.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Run the real CLI with every request to the Careerjet API answered by a local
 * server serving `response` (offline). Pass `token: undefined` to run without
 * CAREERJET_API_TOKEN. `cacheFile` isolates the detail cache.
 */
export async function runWithStubApi(
  args: string[],
  opts: { response: unknown; status?: number; token?: string; cacheFile: string; env?: Record<string, string> },
): Promise<{ result: CLIResult; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push({
        url: new URL(request.url),
        authorization: request.headers.get("authorization"),
        userAgent: request.headers.get("user-agent"),
      });
      return new Response(JSON.stringify(opts.response), {
        status: opts.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const dir = mkdtempSync(join(tmpdir(), "careerjet-stub-"));
  const preload = join(dir, "fetch.ts");
  writeFileSync(preload, `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== "https://search.api.careerjet.net" || url.pathname !== "/v4/query") {
        throw new Error("Unexpected request in offline test: " + url.href);
      }
      return originalFetch(${JSON.stringify(server.url.origin)} + url.pathname + url.search, init);
    };
  `);
  try {
    const result = await runCLI(args, {
      preload,
      env: { CAREERJET_API_TOKEN: opts.token, CAREERJET_CACHE_FILE: opts.cacheFile, ...(opts.env ?? {}) },
    });
    return { result, requests };
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}
