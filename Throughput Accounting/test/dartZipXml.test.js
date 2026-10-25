"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { readZipEntries } = require("../src/dart/zip");
const { parseListEntries, decodeEntities } = require("../src/dart/xml");

/** Builds a minimal single-entry ZIP buffer (store or deflate) for testing. */
function buildZip(fileName, content, method /* 0=store, 8=deflate */) {
  const nameBuf = Buffer.from(fileName, "utf8");
  const dataBuf = Buffer.from(content, "utf8");
  const compressed = method === 8 ? zlib.deflateRawSync(dataBuf) : dataBuf;

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(0, 14); // crc32 (unused by our reader)
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const localEntry = Buffer.concat([localHeader, nameBuf, compressed]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(method, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(0, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(dataBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42); // local header offset

  const centralEntry = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8); // entries on this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralEntry.length, 12); // central dir size
  eocd.writeUInt32LE(localEntry.length, 16); // central dir offset (right after local entry)
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localEntry, centralEntry, eocd]);
}

test("readZipEntries extracts a stored (uncompressed) entry", () => {
  const zip = buildZip("hello.txt", "hello world", 0);
  const entries = readZipEntries(zip);
  assert.equal(entries["hello.txt"].toString("utf8"), "hello world");
});

test("readZipEntries extracts a deflate-compressed entry", () => {
  const xml = "<result><list><corp_code>00126380</corp_code></list></result>";
  const zip = buildZip("CORPCODE.xml", xml, 8);
  const entries = readZipEntries(zip);
  assert.equal(entries["CORPCODE.xml"].toString("utf8"), xml);
});

test("parseListEntries reads flat <list> blocks and decodes entities", () => {
  const xml = `<result>
    <list>
      <corp_code>00126380</corp_code>
      <corp_name>Test &amp; Co</corp_name>
      <stock_code></stock_code>
    </list>
    <list>
      <corp_code>00164779</corp_code>
      <corp_name>삼성전자</corp_name>
      <stock_code>005930</stock_code>
    </list>
  </result>`;

  const entries = parseListEntries(xml, ["corp_code", "corp_name", "stock_code"]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].corp_name, "Test & Co");
  assert.equal(entries[0].stock_code, null);
  assert.equal(entries[1].corp_name, "삼성전자");
  assert.equal(entries[1].stock_code, "005930");
});

test("decodeEntities handles numeric entities", () => {
  assert.equal(decodeEntities("A&#38;B"), "A&B");
});
