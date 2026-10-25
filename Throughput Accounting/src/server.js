#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { analyzePeriods } = require("./taEngine");
const { loadCorpCodeList, findCorpByName, resolveCorp } = require("./dart/corpCode");
const { fetchPeriods } = require("./dart/fetchPeriod");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const KEY_FILE = path.join(__dirname, "..", ".dart-api-key");
const REPORT_CODES = { annual: "11011", half: "11012", q1: "11013", q3: "11014" };
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Request-supplied key wins, then DART_API_KEY, then the local gitignored key file. */
function resolveApiKey(requestKey) {
  if (requestKey && requestKey.trim()) return requestKey.trim();
  if (process.env.DART_API_KEY) return process.env.DART_API_KEY;
  if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, "utf8").trim();
  return null;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("Request body is not valid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function handleLookup(url, res) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return sendJson(res, 400, { error: "q (company name) is required" });

  const apiKey = resolveApiKey(url.searchParams.get("apiKey"));
  const list = await loadCorpCodeList(apiKey);
  const matches = findCorpByName(list, q).slice(0, 30);
  sendJson(res, 200, {
    matches: matches.map((m) => ({
      corpCode: m.corp_code,
      corpName: m.corp_name,
      stockCode: m.stock_code,
    })),
  });
}

async function handleFetch(req, res) {
  const body = await readJsonBody(req);
  const { company, years, report = "annual", fs: fsBasis = "cfs" } = body;

  if (!company) return sendJson(res, 400, { error: "company is required" });
  if (!Array.isArray(years) || years.length === 0) {
    return sendJson(res, 400, { error: "years must be a non-empty array, e.g. [2022, 2023]" });
  }
  const reprtCode = REPORT_CODES[report];
  if (!reprtCode) return sendJson(res, 400, { error: `report must be one of: ${Object.keys(REPORT_CODES).join(", ")}` });
  const fsDiv = String(fsBasis).toUpperCase();
  if (!["CFS", "OFS"].includes(fsDiv)) return sendJson(res, 400, { error: "fs must be cfs or ofs" });

  const apiKey = resolveApiKey(body.apiKey);
  const corp = await resolveCorp(String(company), apiKey);

  const yearList = years
    .map((y) => String(y).trim())
    .filter((y) => /^\d{4}$/.test(y))
    .sort((a, b) => Number(a) - Number(b))
    .map((year) => ({ year, reprtCode, label: year }));
  if (yearList.length === 0) return sendJson(res, 400, { error: "years must be 4-digit years" });

  const results = await fetchPeriods({ apiKey, corpCode: corp.corp_code, fsDiv, years: yearList });
  sendJson(res, 200, {
    corp: { corpCode: corp.corp_code, corpName: corp.corp_name },
    periods: results.map((r) => r.period),
    warnings: results.map((r) => ({ label: r.period.label, ...r.warnings })),
  });
}

async function handleAnalyze(req, res) {
  const body = await readJsonBody(req);
  const periods = Array.isArray(body) ? body : body.periods;
  if (!Array.isArray(periods)) {
    return sendJson(res, 400, { error: 'Body must be an array of periods, or { "periods": [...] }' });
  }
  sendJson(res, 200, { results: analyzePeriods(periods) });
}

function serveStatic(urlPath, res) {
  const relative = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relative);

  // Reject path traversal out of public/
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const type = CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/dart/lookup") return await handleLookup(url, res);
    if (req.method === "POST" && url.pathname === "/api/dart/fetch") return await handleFetch(req, res);
    if (req.method === "POST" && url.pathname === "/api/analyze") return await handleAnalyze(req, res);
    if (req.method === "GET" && url.pathname === "/api/sample") {
      const sample = fs.readFileSync(path.join(__dirname, "..", "examples", "sample-input.json"), "utf8");
      return sendJson(res, 200, JSON.parse(sample));
    }
    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, { hasServerApiKey: Boolean(resolveApiKey(null)) });
    }
    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Unknown API route" });
    if (req.method === "GET") return serveStatic(url.pathname, res);
    res.writeHead(405).end("Method not allowed");
  } catch (err) {
    sendJson(res, err.status || 500, { error: err.message });
  }
});

// Bind to loopback only: this app can spend the user's DART API quota.
if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Throughput Accounting web app: http://localhost:${PORT}`);
  });
}

module.exports = { server };
