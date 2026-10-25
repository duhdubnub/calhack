import test from "node:test";
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { moduleHandler } from "../insights/shared.js";
import { config, serverDirectory } from "../config.js";

test("explicit insight retry refreshes a cached failure and retains the new successful result", async () => {
  const name = "retry-test-" + randomUUID();
  let calls = 0;
  const original = config.useFixtures;
  config.useFixtures = false;
  try {
    const handler = moduleHandler(name, () => ({lat: 37}), async () => {
      if (++calls === 1) throw Error("Provider temporarily unavailable");
      return {minutes: 12};
    });
    await assert.rejects(handler({}), /temporarily unavailable/);
    await assert.rejects(handler({}), /temporarily unavailable/);
    assert.equal(calls, 1);
    assert.equal((await handler({retry: "1"})).minutes, 12);
    assert.equal((await handler({})).minutes, 12);
    assert.equal(calls, 2);
  } finally {
    config.useFixtures = original;
    await unlink(join(serverDirectory, ".cache", `insight-${name}.json`)).catch(()=>{});
  }
});
