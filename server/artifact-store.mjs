export const DEFAULT_ARTIFACT_STORE_OPTIONS = Object.freeze({
  maxEntries: 100,
  maxBytes: 64 * 1024 * 1024,
  ttlMs: 60 * 60 * 1000,
  maxArtifactBytes: 2 * 1024 * 1024,
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirePositiveSafeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

export function createArtifactStore({
  maxEntries = DEFAULT_ARTIFACT_STORE_OPTIONS.maxEntries,
  maxBytes = DEFAULT_ARTIFACT_STORE_OPTIONS.maxBytes,
  ttlMs = DEFAULT_ARTIFACT_STORE_OPTIONS.ttlMs,
  maxArtifactBytes = DEFAULT_ARTIFACT_STORE_OPTIONS.maxArtifactBytes,
  now = Date.now,
} = {}) {
  requirePositiveSafeInteger("maxEntries", maxEntries);
  requirePositiveSafeInteger("maxBytes", maxBytes);
  requirePositiveSafeInteger("ttlMs", ttlMs);
  requirePositiveSafeInteger("maxArtifactBytes", maxArtifactBytes);
  if (typeof now !== "function") throw new TypeError("now must be a function");

  const entries = new Map();
  let bytes = 0;

  function currentTime() {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError("now must return a finite number");
    return value;
  }

  function remove(id) {
    const artifact = entries.get(id);
    if (!artifact) return false;
    entries.delete(id);
    bytes -= artifact.bytes;
    return true;
  }

  function pruneExpired(at) {
    for (const [id, artifact] of entries) {
      if (at >= artifact.createdAt + ttlMs) remove(id);
    }
  }

  function evictOldest() {
    const oldestId = entries.keys().next().value;
    return oldestId === undefined ? false : remove(oldestId);
  }

  return {
    put(id, artifact) {
      const at = currentTime();
      pruneExpired(at);
      if (typeof id !== "string" || id.length === 0) {
        return { ok: false, error: "artifact id must be a non-empty string" };
      }
      if (
        !isRecord(artifact) ||
        typeof artifact.title !== "string" ||
        typeof artifact.type !== "string" ||
        typeof artifact.html !== "string" ||
        typeof artifact.hash !== "string"
      ) {
        return { ok: false, error: "artifact must include string title, type, html, and hash fields" };
      }

      const artifactBytes = Buffer.byteLength(artifact.html, "utf8");
      if (artifactBytes > maxArtifactBytes) {
        return { ok: false, error: `artifact exceeds the ${maxArtifactBytes}-byte per-artifact limit` };
      }
      if (artifactBytes > maxBytes) {
        return { ok: false, error: `artifact exceeds the ${maxBytes}-byte total store limit` };
      }

      // Replacement gets a fresh creation time and moves to the newest end of
      // insertion order, while rejected replacements leave the old entry intact.
      remove(id);
      const stored = Object.freeze({
        title: artifact.title,
        type: artifact.type,
        html: artifact.html,
        hash: artifact.hash,
        bytes: artifactBytes,
        createdAt: at,
      });
      entries.set(id, stored);
      bytes += artifactBytes;

      while (entries.size > maxEntries || bytes > maxBytes) evictOldest();
      return { ok: true };
    },

    get(id) {
      // Retention is measured from creation time; reads never extend the TTL.
      pruneExpired(currentTime());
      return entries.get(id);
    },

    delete(id) {
      pruneExpired(currentTime());
      return remove(id);
    },

    clear() {
      entries.clear();
      bytes = 0;
    },

    stats() {
      pruneExpired(currentTime());
      return { entries: entries.size, bytes };
    },
  };
}
