"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { server } = require("../src/server");

let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test("POST /api/analyze runs the engine on the bundled sample", async () => {
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "examples", "sample-input.json"), "utf8"));
  const res = await fetch(`${base}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sample),
  });
  assert.equal(res.status, 200);
  const { results } = await res.json();
  assert.equal(results.length, 2);
  assert.ok(Math.abs(results[0].throughputPL.throughput - 48809.5) < 1);
});

test("POST /api/analyze rejects malformed bodies with 400", async () => {
  const bad = await fetch(`${base}/api/analyze`, { method: "POST", body: "{not json" });
  assert.equal(bad.status, 400);
  const wrongShape = await fetch(`${base}/api/analyze`, { method: "POST", body: JSON.stringify({ nope: 1 }) });
  assert.equal(wrongShape.status, 400);
});

test("static server serves index.html and blocks path traversal", async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Throughput Accounting/);

  const traversal = await fetch(`${base}/..%2Fpackage.json`);
  assert.notEqual(traversal.status, 200);
});
