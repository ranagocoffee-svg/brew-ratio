"use strict";

const { FIELD_DEFS, resolveField } = require("./accounts");

const FLOW_STATEMENTS = new Set(["IS", "CIS", "CF"]); // period-flow statements vs. point-in-time BS

/**
 * Resolves every field in FIELD_DEFS for one period column.
 * @param rows DART fnlttSinglAcntAll rows (one fs_div's worth)
 * @param column "current" | "prior" - which period's amount to read
 * @param isAnnual whether this is an annual (11011) report, which has no
 *   "*_add_amount" cumulative column (thstrm_amount is already full-year)
 */
function resolveAllFields(rows, column, isAnnual) {
  const resolved = {};
  const unresolved = [];

  for (const [field, def] of Object.entries(FIELD_DEFS)) {
    const isFlow = FLOW_STATEMENTS.has(def.sjDiv);
    let amountKey;
    if (column === "current") {
      amountKey = isFlow && !isAnnual ? "thstrm_add_amount" : "thstrm_amount";
    } else {
      amountKey = isFlow && !isAnnual ? "frmtrm_add_amount" : "frmtrm_amount";
    }

    let hit = resolveField(rows, def, amountKey);
    // Cumulative add-amount columns are sometimes blank even when present on
    // the row; fall back to the plain amount column rather than reporting
    // the field as entirely unresolved.
    if (!hit && amountKey.endsWith("_add_amount")) {
      hit = resolveField(rows, def, amountKey.replace("_add_amount", "_amount"));
    }

    if (hit) {
      resolved[field] = hit.value;
    } else {
      resolved[field] = null;
      unresolved.push({ field, sjDiv: def.sjDiv, reason: "no matching account_id/account_nm in rows" });
    }
  }

  return { resolved, unresolved };
}

/**
 * Builds a draft TA engine period input (plus manual-fill guidance) from
 * resolved DART fields for the current period, the equivalent prior-period
 * balance sheet (for `opening`, when this is the first requested period),
 * and optional employee-status figures.
 */
function buildDraftPeriod({ label, current, priorBalanceSheetOnly, employeeStatus }) {
  const r = current;
  const nonOperating = {
    otherIncomeExpense: sumOrNull(r.otherIncome, negate(r.otherExpenses)),
    financialIncomeExpense: sumOrNull(r.financeIncome, negate(r.financeCosts)),
    equityMethodGainLoss: r.shareOfAssociatesProfit,
  };

  const period = {
    label,
    revenue: r.revenue,
    cogs: r.cogs,
    sga: r.sga,
    costNature: {
      wipFgChange: null, // MANUAL: 주석 "비용의 성격별 분류" - 제품과 재공품의 감소(증가)
      materialsUsed: null, // MANUAL: 같은 주석 - 원재료 및 소모품 사용액
      merchandisePurchased: 0,
    },
    inventory: {
      wcaiEnd: null, // MANUAL: 주석 "재고자산" - 제품 + 재공품 (가공비가 배부된 재고)
      contractAssetEnd: 0,
    },
    nonOperating,
    interestPaid: r.interestPaidCF !== null ? Math.abs(r.interestPaidCF) : null,
    taxExpense: r.incomeTaxExpense,
    comprehensiveIncomeAdjustments: {
      discontinuedOps: 0,
      oci: r.oci,
      accountingPolicyChange: 0,
      ani: sumOrNull(r.depreciationCF, r.amortisationCF), // proxy: D&A add-back only
    },
    employees: employeeStatus?.employees ?? null,
    laborCost: employeeStatus?.laborCost ?? null,
    balanceSheet: {
      currentAssets: r.currentAssets,
      cash: r.cash,
      receivables: r.receivables,
      nonCurrentAssets: r.nonCurrentAssets,
      totalAssets: r.totalAssets,
      payables: r.payables,
      shortTermDebt: r.shortTermDebt,
      currentLiabilities: r.currentLiabilities,
      longTermDebt: r.longTermDebt,
      nonCurrentLiabilities: r.nonCurrentLiabilities,
      totalLiabilities: r.totalLiabilities,
      totalEquity: r.totalEquity,
    },
  };

  if (priorBalanceSheetOnly) {
    period.opening = {
      comprehensiveWcaiBegin: null, // MANUAL: see inventory.wcaiEnd above, for the PRIOR period-end
      balanceSheet: {
        currentAssets: priorBalanceSheetOnly.currentAssets,
        cash: priorBalanceSheetOnly.cash,
        receivables: priorBalanceSheetOnly.receivables,
        nonCurrentAssets: priorBalanceSheetOnly.nonCurrentAssets,
        totalAssets: priorBalanceSheetOnly.totalAssets,
        payables: priorBalanceSheetOnly.payables,
        shortTermDebt: priorBalanceSheetOnly.shortTermDebt,
        currentLiabilities: priorBalanceSheetOnly.currentLiabilities,
        longTermDebt: priorBalanceSheetOnly.longTermDebt,
        nonCurrentLiabilities: priorBalanceSheetOnly.nonCurrentLiabilities,
        totalLiabilities: priorBalanceSheetOnly.totalLiabilities,
        totalEquity: priorBalanceSheetOnly.totalEquity,
      },
    };
  }

  return period;
}

function negate(v) {
  return v === null || v === undefined ? null : -v;
}

function sumOrNull(...vals) {
  const present = vals.filter((v) => v !== null && v !== undefined);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

module.exports = { resolveAllFields, buildDraftPeriod };
