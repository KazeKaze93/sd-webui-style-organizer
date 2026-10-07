/**
 * Run Vitest and fail if passed test count is below the pinned minimum.
 */
import { spawnSync } from "node:child_process";

/** Pinned floor — raise when the suite grows; never lower without an intentional cull. */
const MIN_TESTS = 69;

const result = spawnSync("npx", ["vitest", "run", ...process.argv.slice(2)], {
  encoding: "utf8",
  shell: true,
  env: process.env,
});

const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const match = out.match(/Tests\s+(\d+)\s+passed/);
const passed = match ? Number(match[1]) : 0;

if (result.status !== 0 && result.status !== null) {
  process.exit(result.status);
}

if (passed < MIN_TESTS) {
  console.error(
    `FAIL: Vitest passed ${passed} tests; pinned minimum is ${MIN_TESTS}.`
  );
  process.exit(1);
}

process.exit(0);
