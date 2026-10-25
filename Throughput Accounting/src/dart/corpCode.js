"use strict";

const fs = require("fs");
const path = require("path");
const { fetchCorpCodeZip } = require("./client");
const { readZipEntries } = require("./zip");
const { parseListEntries } = require("./xml");

const CACHE_PATH = path.join(__dirname, "..", "..", ".cache", "corpCode.json");
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // DART publishes a fresh corpCode list daily, but it rarely changes.

async function loadCorpCodeList(apiKey, { forceRefresh = false } = {}) {
  if (!forceRefresh && fs.existsSync(CACHE_PATH)) {
    const stat = fs.statSync(CACHE_PATH);
    if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    }
  }

  const zipBuffer = await fetchCorpCodeZip(apiKey);
  const entries = readZipEntries(zipBuffer);
  const xmlFileName = Object.keys(entries).find((n) => n.toLowerCase().endsWith(".xml"));
  if (!xmlFileName) throw new Error("corpCode.xml not found inside the downloaded ZIP");

  const xml = entries[xmlFileName].toString("utf8");
  const list = parseListEntries(xml, ["corp_code", "corp_name", "corp_eng_name", "stock_code", "modify_date"]);

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(list), "utf8");
  return list;
}

/**
 * Finds companies whose name matches `query`. Tries an exact match first
 * (after stripping whitespace), then falls back to a substring match, since
 * DART company names often carry a legal-form suffix (e.g. "(주)") that
 * users won't type.
 */
function findCorpByName(list, query) {
  const normalized = query.replace(/\s+/g, "");
  const exact = list.filter((c) => c.corp_name.replace(/\s+/g, "") === normalized);
  if (exact.length) return exact;
  return list.filter((c) => c.corp_name.replace(/\s+/g, "").includes(normalized));
}

module.exports = { loadCorpCodeList, findCorpByName, CACHE_PATH };
