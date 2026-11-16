#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { analyzePeriods } = require("./taEngine");
const { money, pct, ratio, row } = require("./format");
const { loadCorpCodeList, findCorpByName, resolveCorp } = require("./dart/corpCode");
const { fetchPeriods } = require("./dart/fetchPeriod");

function printUsage() {
  console.log(`Usage:
  node src/cli.js analyze <input.json> [--json] [--out <file.json>]
  node src/cli.js dart lookup <company name> [--api-key <key>]
  node src/cli.js dart fetch <company name> --years <y1,y2,...> [options]

analyze:
  <input.json>   Path to a TA input file (see examples/sample-input.json and README.md).
  --json         Print the full result as JSON instead of a formatted report.
  --out <file>   Also write the full result JSON to <file>.

dart lookup:
  Finds a company's 8-digit DART corp_code by (partial) name.

dart fetch:
  Pulls periodic-report financial data from DART (dart.fss.or.kr OpenAPI) and
  writes a DRAFT TA input file. Fields not available from DART's standard
  statement API (WCAI/costNature - see README.md) are left as null for you to
  fill in from the report's notes before running "analyze" on it.

  --years <list>   Comma-separated fiscal years, e.g. 2022,2023,2024 (required)
  --report <type>  annual | half | q1 | q3 (default: annual)
  --fs <basis>     cfs (consolidated, default) | ofs (separate/standalone)
  --out <file>     Output path (default: output/dart-draft-<corp_code>.json)
  --api-key <key>  DART API key (or set the DART_API_KEY env var)

A DART API key is required for "dart" commands: register for free at
https://opendart.fss.or.kr (Claude cannot do this on your behalf).
`);
}

function printReport(results) {
  for (const r of results) {
    console.log("=".repeat(72));
    console.log(`  ${r.label}`);
    console.log("=".repeat(72));

    console.log("\n[Legacy Cost P&L]");
    const l = r.legacyCostPL;
    console.log(row("매출 Revenue", money(l.revenue)));
    console.log(row("매출원가 COGS", money(l.cogs)));
    console.log(row("매출총이익 Gross Profit", money(l.grossProfit), pct(l.grossMargin)));
    console.log(row("판관비 SG&A", money(l.sga), pct(l.sgaRatio)));
    console.log(row("영업이익 Operating Profit", money(l.operatingProfit), pct(l.operatingMargin)));
    console.log(row("법인세차감전순이익 Pretax Profit", money(l.pretaxProfit)));
    console.log(row("당기순이익 Net Profit", money(l.netProfit)));

    console.log("\n[Throughput P&L]");
    const t = r.throughputPL;
    console.log(row("매출재료비 TVC (Sales Material Cost)", money(t.salesMaterialCost)));
    console.log(row("Throughput (T)", money(t.throughput), pct(t.throughputRate)));
    console.log(row("현장운영경비 Working Cost", money(t.workingCost)));
    console.log(row("OE (Operating Expense)", money(t.oe), pct(t.oeRate)));
    console.log(row("T/OE 생산성 Productivity", ratio(t.productivityTOE)));
    console.log(
      row("Throughput 영업이익", money(t.throughputOperatingProfit), pct(t.throughputOperatingMargin))
    );
    console.log(
      row(
        "  vs 원가회계 영업이익 GAP",
        money(t.throughputOperatingProfit - r.legacyCostPL.operatingProfit)
      )
    );
    if (t.note) console.log(`  note: ${t.note}`);
    if (t.dataQualityCheck?.gap !== null && t.dataQualityCheck?.gap !== undefined) {
      console.log(row("  data-quality GAP (B+C vs Q)", money(t.dataQualityCheck.gap)));
    }

    console.log("\n[Capital / ROI Metrics]");
    const c = r.capitalMetrics;
    console.log(row("WCAI Turn (매출원가/포괄WCAI)", ratio(c.wcaiTurn)));
    console.log(row("ROI Inventory (T영업이익/포괄WCAI)", pct(c.roiInventory)));
    console.log(row("투하자본 Invested Capital", money(c.investedCapital)));
    console.log(row("ROIC (T영업이익/투하자본)", pct(c.roic)));
    console.log(row("이자보상배율 Interest Coverage", ratio(c.interestCoverage)));
    console.log(row("듀퐁 ROI (P x T)", pct(c.dupontROI)));
    console.log(row("총자산회전율 Asset Turnover", ratio(c.totalAssetTurnover)));
    console.log(row("매출채권회전율 Receivable Turnover", ratio(c.receivableTurnover)));
    console.log(row("매입채무회전율 Payable Turnover", ratio(c.payableTurnover)));
    console.log(row("Cash Buffer Ratio", pct(c.cashBufferRatio)));

    console.log("\n[AtMAN Cash-Flow Metrics]");
    const cf = r.cashFlowMetrics;
    console.log(row("EBIT", money(cf.ebit)));
    console.log(row("EAT (세후현금순이익)", money(cf.eat)));
    if (cf.note) {
      console.log(`  note: ${cf.note}`);
    } else {
      console.log(row("CBF (현금버퍼흐름)", money(cf.cashBufferFlow)));
      console.log(row("NWC_CF (순운전자본흐름)", money(cf.nwcCashFlow)));
      console.log(row("CAPEX (비유동자산흐름)", money(cf.capex)));
      console.log(row("EMS (Earned Money Sales)", money(cf.ems)));
      console.log(row("FEM (Final Earned Money)", money(cf.fem)));
      console.log(row("FCFC (채권자 잉여현금흐름)", money(cf.fcfc)));
      console.log(row("FCFE (주주 잉여현금흐름)", money(cf.fcfe)));
      console.log(row("FCFF (회사 잉여현금흐름)", money(cf.fcff)));
      console.log(row("ROE (FCFE/투하자본)", pct(cf.roe)));
    }
    console.log("");
  }
}

function getFlag(args, name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

function cmdAnalyze(args) {
  const inputPath = args[0];
  if (!inputPath) throw new Error("Usage: node src/cli.js analyze <input.json> [--json] [--out <file.json>]");

  const asJson = args.includes("--json");
  const outPath = getFlag(args, "--out");

  const raw = fs.readFileSync(path.resolve(inputPath), "utf8");
  const data = JSON.parse(raw);
  const periods = Array.isArray(data) ? data : data.periods;

  if (!Array.isArray(periods)) {
    throw new Error('Input JSON must be an array of periods, or an object with a "periods" array.');
  }

  const results = analyzePeriods(periods);

  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), JSON.stringify(results, null, 2), "utf8");
    console.log(`Wrote full results to ${outPath}`);
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printReport(results);
  }
}

function resolveApiKey(args) {
  return getFlag(args, "--api-key") || process.env.DART_API_KEY || null;
}

async function cmdDartLookup(args) {
  const query = args[0];
  if (!query) throw new Error("Usage: node src/cli.js dart lookup <company name> [--api-key <key>]");
  const apiKey = resolveApiKey(args);

  const list = await loadCorpCodeList(apiKey);
  const matches = findCorpByName(list, query);

  if (matches.length === 0) {
    console.log(`No match for "${query}".`);
    return;
  }
  console.log(`${matches.length} match(es) for "${query}":\n`);
  for (const m of matches.slice(0, 20)) {
    console.log(`  ${m.corp_name}${m.stock_code ? ` (${m.stock_code})` : ""}  corp_code=${m.corp_code}`);
  }
  if (matches.length > 20) console.log(`  ...and ${matches.length - 20} more`);
}

const REPORT_CODES = { annual: "11011", half: "11012", q1: "11013", q3: "11014" };


async function cmdDartFetch(args) {
  const query = args[0];
  if (!query) {
    throw new Error("Usage: node src/cli.js dart fetch <company name> --years <y1,y2,...> [options]");
  }
  const apiKey = resolveApiKey(args);
  const yearsArg = getFlag(args, "--years");
  if (!yearsArg) throw new Error("--years is required, e.g. --years 2022,2023,2024");

  const reportType = getFlag(args, "--report") || "annual";
  const reprtCode = REPORT_CODES[reportType];
  if (!reprtCode) {
    throw new Error(`--report must be one of: ${Object.keys(REPORT_CODES).join(", ")}`);
  }
  const fsDiv = (getFlag(args, "--fs") || "cfs").toUpperCase();
  if (!["CFS", "OFS"].includes(fsDiv)) throw new Error("--fs must be cfs or ofs");

  const corp = await resolveCorp(query, apiKey);
  console.log(`Resolved "${query}" -> ${corp.corp_name} (corp_code=${corp.corp_code})`);

  const years = yearsArg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b))
    .map((year) => ({ year, reprtCode, label: year }));

  const results = await fetchPeriods({ apiKey, corpCode: corp.corp_code, fsDiv, years });

  const outPath =
    getFlag(args, "--out") || path.join("output", `dart-draft-${corp.corp_code}-${reportType}.json`);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(
    path.resolve(outPath),
    JSON.stringify({ periods: results.map((r) => r.period) }, null, 2),
    "utf8"
  );
  console.log(`\nWrote draft TA input to ${outPath}`);

  console.log("\nManual fields still needed before running 'analyze' (not available via DART's standard API):");
  for (const { period, warnings } of results) {
    console.log(`  [${period.label}] ${warnings.manualFieldsRequired.join(", ")}`);
    if (warnings.unresolvedFromDart.length) {
      console.log(
        `  [${period.label}] could not auto-resolve from DART: ${warnings.unresolvedFromDart
          .map((u) => u.field)
          .join(", ")}`
      );
    }
    if (!warnings.employeeStatusFound) {
      console.log(`  [${period.label}] no 직원현황 data found (employees/laborCost left null)`);
    }
  }
  console.log(
    "\nNote: comprehensiveIncomeAdjustments.ani is auto-filled as a depreciation+amortization-only " +
      "proxy (from the cash flow statement), not the full non-cash adjustment figure."
  );
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const [cmd, ...rest] = args;

  if (cmd === "analyze") {
    cmdAnalyze(rest);
  } else if (cmd === "dart") {
    const [subcmd, ...subArgs] = rest;
    if (subcmd === "lookup") await cmdDartLookup(subArgs);
    else if (subcmd === "fetch") await cmdDartFetch(subArgs);
    else throw new Error(`Unknown "dart" subcommand: ${subcmd}. Use "lookup" or "fetch".`);
  } else {
    // Backward-compatible shorthand: `node src/cli.js <input.json>` == analyze
    cmdAnalyze(args);
  }
}

main(process.argv).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
