const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const { test } = require("node:test");

test("CAPA sync sends corrected item averages and recovery once", () => {
  const values = {
    CAPA_INGEST_URL: "https://example.test/api/capa/ingest",
    CAPA_INGEST_SECRET: "test-secret",
    CAPA_SYNC_START_AT: new Date(Date.now() - 86_400_000).toISOString(),
  };
  const stamp = new Date(Date.now() - 60_000).toISOString();
  const row = (score, parameter) => ({
    auditId: "AUDIT-1", item: "Rateng Patah", branch: "Mojokerto",
    product: "Rateng", name: "Auditor", timestamp: stamp,
    attribute: parameter, score, feedback: "Perbaiki", documentation: "",
  });
  let rows = [row(2, "Rasa"), row(2, "Tampilan")];
  const sent = [];
  const props = {
    getProperty: (key) => values[key] ?? null,
    setProperty: (key, value) => { values[key] = value; },
    deleteProperty: (key) => { delete values[key]; },
    getProperties: () => ({ ...values }),
  };
  const context = {
    DashboardData: { readFromSheet: () => rows },
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_algorithm, input) => [...createHash("sha256").update(input).digest()],
    },
    UrlFetchApp: { fetch: (_url, options) => {
      sent.push(JSON.parse(options.payload));
      return { getResponseCode: () => 200 };
    } },
    console,
  };
  const source = readFileSync(join(__dirname, "../gas/CapaSync.gs"), "utf8");
  runInNewContext(source, context);

  context.syncDikichiCapa();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].parameters.reduce((sum, p) => sum + p.score, 0) / 2, 2);
  context.syncDikichiCapa();
  assert.equal(sent.length, 1);

  rows = [row(4, "Rasa"), row(4, "Tampilan")];
  context.syncDikichiCapa();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].parameters[0].score, 4);
  context.syncDikichiCapa();
  assert.equal(sent.length, 2);

  rows = [row(1, "Rasa"), row(2, "Tampilan")];
  context.syncDikichiCapa();
  assert.equal(sent.length, 3);
  assert.equal(sent[2].parameters[0].score, 1);
});
