import assert from "node:assert/strict";
import { createArtifactStore, DEFAULT_ARTIFACT_STORE_OPTIONS } from "../server/artifact-store.mjs";

const artifact = (html) => ({ title: "Test", type: "architecture", html, hash: "test-hash" });
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.stack || error}`);
  }
}

check("default_retention_budgets", () => {
  assert.deepEqual(DEFAULT_ARTIFACT_STORE_OPTIONS, {
    maxEntries: 100,
    maxBytes: 64 * 1024 * 1024,
    ttlMs: 60 * 60 * 1000,
    maxArtifactBytes: 2 * 1024 * 1024,
  });
});

check("entry_byte_ttl_limits", () => {
  let now = 0;
  const store = createArtifactStore({
    maxEntries: 2,
    maxBytes: 8,
    ttlMs: 100,
    maxArtifactBytes: 6,
    now: () => now,
  });

  assert.deepEqual(store.put("one", artifact("é")), { ok: true });
  assert.deepEqual(store.put("two", artifact("abc")), { ok: true });
  assert.equal(store.get("one").bytes, 2, "byte count uses UTF-8 rather than JS string length");
  assert.equal(store.get("one").createdAt, 0);

  now = 10;
  assert.deepEqual(store.put("three", artifact("1234")), { ok: true });
  assert.equal(store.get("one"), undefined, "aggregate byte pressure evicts the oldest entry first");
  assert.deepEqual(store.stats(), { entries: 2, bytes: 7 });

  assert.deepEqual(store.put("two", artifact("xy")), { ok: true });
  assert.equal(store.get("two").bytes, 2, "replacement stores new UTF-8 byte metadata");
  assert.equal(store.get("two").createdAt, now, "replacement starts a new creation-time TTL");
  assert.deepEqual(store.stats(), { entries: 2, bytes: 6 }, "replacement adjusts the total byte count");

  const beforeOversize = store.stats();
  const rejected = store.put("two", artifact("1234567"));
  assert.equal(rejected.ok, false, "oversize artifact is rejected");
  assert.ok(rejected.error);
  assert.deepEqual(store.stats(), beforeOversize, "rejected replacement preserves the live entry and totals");
  assert.equal(store.get("two").html, "xy");

  assert.equal(store.delete("three"), true);
  assert.equal(store.delete("missing"), false);
  assert.deepEqual(store.stats(), { entries: 1, bytes: 2 }, "deletion adjusts byte totals");

  now = 109;
  assert.equal(store.get("two").html, "xy", "reads do not extend the creation-time TTL");
  now = 110;
  assert.equal(store.get("two"), undefined, "an entry expires at its TTL boundary");
  assert.deepEqual(store.stats(), { entries: 0, bytes: 0 });
});

check("entry_count_eviction_and_expiry_on_insert", () => {
  let now = 0;
  const store = createArtifactStore({
    maxEntries: 2,
    maxBytes: 100,
    ttlMs: 100,
    maxArtifactBytes: 100,
    now: () => now,
  });
  store.put("first", artifact("a"));
  store.put("second", artifact("b"));
  store.put("third", artifact("c"));
  assert.equal(store.get("first"), undefined, "entry count evicts oldest insertion");
  assert.deepEqual(store.stats(), { entries: 2, bytes: 2 });

  const expiryStore = createArtifactStore({
    maxEntries: 2,
    maxBytes: 100,
    ttlMs: 10,
    maxArtifactBytes: 100,
    now: () => now,
  });
  expiryStore.put("stale", artifact("old"));
  now = 10;
  expiryStore.put("fresh", artifact("new"));
  assert.equal(expiryStore.get("stale"), undefined, "insertion prunes expired entries");
  assert.equal(expiryStore.get("fresh").createdAt, 10);
  assert.deepEqual(expiryStore.stats(), { entries: 1, bytes: 3 });
});

check("total_byte_budget_rejects_an_item_that_cannot_fit", () => {
  let now = 0;
  const store = createArtifactStore({
    maxEntries: 3,
    maxBytes: 2,
    ttlMs: 100,
    maxArtifactBytes: 4,
    now: () => now,
  });
  assert.equal(store.put("too-large", artifact("abc")).ok, false);
  assert.deepEqual(store.stats(), { entries: 0, bytes: 0 }, "an unretainable item is rejected before insertion");
  assert.equal(store.put("retained", artifact("xy")).ok, true);
  assert.deepEqual(store.stats(), { entries: 1, bytes: 2 });
  store.clear();
  assert.deepEqual(store.stats(), { entries: 0, bytes: 0 }, "clear removes retained entries and resets byte totals");
});

if (failures > 0) process.exitCode = 1;
