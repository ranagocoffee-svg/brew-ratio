# Throughput Accounting (TA) Analyzer

A small Node.js program that converts standard financial-statement figures into
a **Throughput Accounting** analysis: it reconstructs a Legacy (absorption)
Cost P&L, derives a **Throughput P&L** (T, OE, Throughput Operating Profit),
and computes TOC productivity/ROI metrics plus **AtMAN cash-flow indicators**
(EAT / EMS / FEM / FCFC / FCFE / FCFF / ROE).

The formulas are generalized from the proprietary "TA 분석알고리즘" template
found in `data analysis/2025년 TA분석알고리즘.xlsx` (김천년's TOC-based
Throughput Accounting method), simplified so WCAI and contract-asset balances
are supplied directly rather than re-derived from inventory sub-schedules, and
scoped to: Throughput P&L, productivity/ROI metrics, and AtMAN cash
indicators. Forecasting/quote-strategy scenarios (A/B/C/D Plan in the original
spreadsheet) and the stock-price impact section are **out of scope** for this
program.

## Quick start

```bash
node src/cli.js analyze examples/sample-input.json
```

(`node src/cli.js examples/sample-input.json` also works, as a shorthand for `analyze`.)

Flags:
- `--json` — print the full result as JSON instead of the formatted report.
- `--out <file>` — also write the full result JSON to `<file>`.

Run the test suite:

```bash
npm test
```

## Pulling source data from DART (dart.fss.or.kr 정기공시)

Instead of hand-typing every figure, you can pull a company's periodic-report
(사업보고서/반기보고서/분기보고서) financial statements from the **DART
OpenAPI** (opendart.fss.or.kr) and generate a draft TA input file.

**1. Get a free DART API key** (required — register yourself at
<https://opendart.fss.or.kr>; this cannot be done on your behalf). Then either:

```bash
export DART_API_KEY=your_40_char_key   # or pass --api-key <key> on every command
```

**2. Find the company's corp_code:**

```bash
node src/cli.js dart lookup 현대모비스
```

**3. Fetch a draft TA input file for one or more fiscal years:**

```bash
node src/cli.js dart fetch 현대모비스 --years 2022,2023,2024 --report annual --fs cfs
```

This writes `output/dart-draft-<corp_code>-annual.json` and prints which
fields could not be auto-filled.

**4. Fill in the fields DART's standard statement API does not expose**
(see "What `dart fetch` cannot auto-fill" below), then run the normal
analysis:

```bash
node src/cli.js analyze output/dart-draft-<corp_code>-annual.json
```

### `dart fetch` options

| Flag | Description |
|---|---|
| `--years <y1,y2,...>` | Required. Fiscal years, e.g. `2022,2023,2024` |
| `--report <type>` | `annual` (사업보고서, default) \| `half` (반기) \| `q1` \| `q3` |
| `--fs <basis>` | `cfs` (연결, default) \| `ofs` (별도) |
| `--out <file>` | Output path (default: `output/dart-draft-<corp_code>-<report>.json`) |
| `--api-key <key>` | DART API key (or set `DART_API_KEY`) |

### What `dart fetch` auto-fills

Pulled from DART's `fnlttSinglAcntAll` (전체 재무제표) by matching each
line's standard XBRL `account_id` first, then its Korean `account_nm` label:
revenue, COGS, SG&A, finance income/costs, other income/expenses, equity-
method gain/loss, income tax expense, OCI, and the balance sheet (current/
non-current assets, cash, receivables, payables, short/long-term debt,
total assets/liabilities/equity). Employee count and labor cost come from
the separate `empSttus` (직원현황) API.

### What `dart fetch` cannot auto-fill

DART's standard statement API only covers the main financial statements, not
their footnotes, so these must be read from the actual 사업보고서/반기보고서
and entered by hand into the draft file before running `analyze`:

- `costNature.wipFgChange` and `costNature.materialsUsed` — from the
  "비용의 성격별 분류" note (제품과 재공품의 감소(증가), 원재료 및 소모품
  사용액).
- `inventory.wcaiEnd` (and `opening.comprehensiveWcaiBegin` on the first
  period) — from the "재고자산" note: 제품 + 재공품 (the portion of
  inventory valued with allocated processing cost).

Two more fields are filled with a **best-effort approximation**, flagged in
the `dart fetch` output — review them rather than trusting them blindly:

- `interestPaid` — read from the cash flow statement's "이자의 지급" line,
  which has no standard XBRL tag and is matched by label only.
- `comprehensiveIncomeAdjustments.ani` — approximated as depreciation +
  amortization add-backs from the cash flow statement only, not the full set
  of non-cash adjustments.

`dart fetch` prints exactly which fields are missing/approximated for each
requested period, and also lists any field it could not resolve at all
(`unresolvedFromDart`) — this can happen when a filer used a non-standard
label DART's `account_id`/`account_nm` matching here doesn't recognize; in
that case, read the amount directly from the filing.

## Core formulas

**Throughput P&L** (per period):

```
MC (Material Cost, by nature)   = A(WIP/FG change) + B(materials used) + C(merchandise purchased)
WC (Working Cost / factory OE)  = COGS - MC
Comprehensive WCAI              = WCAI(제품+재공품) + Contract Assets
Total Manufacturing Cost (Q)    = COGS + Δ(Comprehensive WCAI)
Production Material Cost        = Total Manufacturing Cost - WC
Sales Material Cost (TVC)       = Production Material Cost × COGS / Total Manufacturing Cost
T (Throughput)                  = Revenue - Sales Material Cost
OE (Operating Expense)          = WC + SG&A
Throughput Operating Profit     = T - OE
```

**Productivity / ROI** (needs a balance sheet):

```
Invested Capital   = Total Assets - Non-Interest-Bearing Liabilities
ROIC               = Throughput Operating Profit / Invested Capital
WCAI Turn          = COGS / Comprehensive WCAI (ending)
ROI Inventory      = Throughput Operating Profit / Comprehensive WCAI (ending)
DuPont ROI          = (Throughput Operating Profit / Revenue) × (Revenue / Total Equity)
```

**AtMAN cash-flow indicators** (needs this period's AND the prior period's
balance sheet):

```
EAT  = Net Profit + (OCI + ANI) + Interest Paid
CBF  = Cash(end) - Cash(begin)
NWC  = Current Assets - Non-Interest-Bearing Liabilities
NWC_CF = NWC(begin) - NWC(end)
CAPEX  = Non-Current Assets(begin) - Non-Current Assets(end)
EMS  = CBF + NWC_CF + EAT
FEM  = EMS + CAPEX - ANI
FCFC = ΔInterest-Bearing Debt(begin - end) + Interest Paid
FCFE = ΔTotal Equity(begin - end) + Total Comprehensive Income
FCFF = FCFC + FCFE
ROE  = FCFE / Invested Capital
```

## Input format

A JSON file containing either an array of periods, or `{ "periods": [...] }`.
Periods **must be in chronological order (oldest first)** — each period after
the first automatically uses the previous period's `inventory`/`balanceSheet`
as its "beginning of period" figures. The very first period has no
predecessor in the array, so it may carry an optional `opening` block to
supply the prior-period figures needed for WCAI deltas and cash-flow metrics;
if omitted, those specific outputs come back as `null` with an explanatory
`note` instead of throwing.

```jsonc
{
  "periods": [
    {
      "label": "2023",
      "revenue": 100000,
      "cogs": 75000,
      "sga": 15000,

      // 비용의 성격별 분류 (cost-by-nature note)
      "costNature": {
        "wipFgChange": 1000,         // A: 제품과 재공품의 감소(증가)
        "materialsUsed": 50000,      // B: 원재료 및 소모품 사용액
        "merchandisePurchased": 0    // C: 상품의 매입액 (optional, default 0)
      },

      // 가공비배부재고자산(제품+재공품) 및 계약자산, 기말
      "inventory": {
        "wcaiEnd": 7600,
        "contractAssetEnd": 0        // optional, default 0
      },

      // 영업외 부문 (all optional, default 0)
      "nonOperating": {
        "otherIncomeExpense": -200,
        "financialIncomeExpense": -800,
        "equityMethodGainLoss": 100
      },

      "interestPaid": 900,           // optional, default 0
      "taxExpense": 2000,            // optional, default 0

      // optional, all default 0
      "comprehensiveIncomeAdjustments": {
        "discontinuedOps": 0,
        "oci": 100,                  // 법인세차감후 기타포괄손익
        "accountingPolicyChange": 0,
        "ani": 1800                  // non-cash adjustments to net income (e.g. depreciation)
      },

      "employees": 120,              // optional, informational only
      "laborCost": 18000,            // optional, informational only

      "balanceSheet": {
        "currentAssets": 60000,
        "cash": 10000,
        "receivables": 20000,
        "nonCurrentAssets": 80000,
        "totalAssets": 140000,       // optional, defaults to currentAssets + nonCurrentAssets
        "payables": 15000,
        "shortTermDebt": 10000,
        "otherCurrentLiabilities": 0,          // optional, default 0
        "currentLiabilities": 25000,           // optional, defaults to payables + shortTermDebt + otherCurrentLiabilities
        "longTermDebt": 20000,
        "otherNonCurrentLiabilities": 0,       // optional, default 0
        "nonCurrentLiabilities": 20000,        // optional, defaults to longTermDebt + otherNonCurrentLiabilities
        "totalLiabilities": 45000,             // optional, defaults to currentLiabilities + nonCurrentLiabilities
        "totalEquity": 95000                   // optional, defaults to totalAssets - totalLiabilities
      },

      // Only meaningful on periods[0]: supplies the "beginning of period"
      // figures that would otherwise come from a (missing) prior period.
      "opening": {
        "comprehensiveWcaiBegin": 7000,
        "balanceSheet": { /* same shape as balanceSheet above */ }
      }
    }
  ]
}
```

See `examples/sample-input.json` for a complete two-period example (synthetic
figures, not real company data).

## Project layout

```
src/taEngine.js      Pure calculation engine (normalizePeriod, legacyCostPL,
                      throughputPL, capitalMetrics, cashFlowMetrics, analyzePeriods)
src/cli.js            CLI: "analyze" (run the engine) and "dart" (lookup/fetch) subcommands
src/format.js         Number/percent/ratio formatting helpers for the report
src/dart/client.js    Raw DART OpenAPI calls (financial statements, employee status, corpCode zip)
src/dart/corpCode.js  Downloads+caches the corp_code list, name -> corp_code lookup
src/dart/zip.js       Minimal dependency-free ZIP reader (for corpCode.xml's ZIP download)
src/dart/xml.js       Minimal dependency-free XML reader (for corpCode.xml)
src/dart/accounts.js  account_id/account_nm -> TA field matching rules
src/dart/mapToTaInput.js  Resolves DART rows into a draft TA period input
src/dart/fetchPeriod.js   Orchestrates fetching + mapping one or more periods
examples/             Sample input
test/                 node:test unit tests covering the engine's formulas and DART mapping
```

## Known limitations

- WCAI (가공비배부재고자산) and contract assets are taken as direct inputs.
  The original spreadsheet re-derives WCAI from inventory-note sub-schedules
  and cross-checks it against the cash-flow statement and fixed-asset
  rollforward (재고자산회계투명성 1–3단계); this program does not reproduce
  those reconciliation stages beyond the single `dataQualityCheck.gap` figure
  in `throughputPL` (difference between the direct materials-used-based and
  WCAI-delta-based derivations of production material cost).
- Forecasting (A/B/C/D Plan revenue/quote scenarios) and the stock-price
  impact section from the original spreadsheet are not implemented.
- The DART integration (`dart fetch`) maps standard-statement line items only;
  it does not parse footnotes/XBRL notes, so cost-by-nature and WCAI figures
  always need manual entry (see "What `dart fetch` cannot auto-fill" above),
  and any filer using non-standard account labels for a main statement line
  may need manual correction too (check `unresolvedFromDart` in the output).
