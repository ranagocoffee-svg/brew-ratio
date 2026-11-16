"use strict";

/**
 * Throughput Accounting (TA) analysis engine.
 *
 * Reconstructs a Legacy (absorption) Cost P&L and a Throughput P&L from standard
 * financial-statement figures, then derives TOC productivity/ROI metrics and
 * AtMAN cash-flow indicators (EAT/EMS/FEM/FCFC/FCFE/FCFF/ROE).
 *
 * Formulas are generalized from the "TA 분석알고리즘" template (Legacy Cost
 * Accounting P&L -> Throughput P&L -> WCAI/inventory reconciliation ->
 * productivity & ROI metrics -> AtMAN cash indicators), simplified to take
 * WCAI (가공비배부재고자산, i.e. finished goods + WIP valued with allocated
 * processing cost) and contract assets as direct period-end inputs rather than
 * re-deriving them from inventory-note sub-schedules.
 */

function num(v, fallback = 0) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new TypeError(`Expected a number, got ${JSON.stringify(v)}`);
  return n;
}

function safeDiv(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

/**
 * Normalizes a raw balance-sheet snapshot, deriving totals that weren't
 * supplied directly. Shared between period.balanceSheet and
 * periods[0].opening.balanceSheet so both get the same defaulting.
 */
function normalizeBalanceSheet(bs) {
  const currentAssets = num(bs.currentAssets);
  const cash = num(bs.cash);
  const receivables = num(bs.receivables);
  const nonCurrentAssets = num(bs.nonCurrentAssets);
  const totalAssets = num(bs.totalAssets, currentAssets + nonCurrentAssets);

  const payables = num(bs.payables);
  const shortTermDebt = num(bs.shortTermDebt, 0);
  const otherCurrentLiabilities = num(bs.otherCurrentLiabilities, 0);
  const currentLiabilities = num(
    bs.currentLiabilities,
    payables + shortTermDebt + otherCurrentLiabilities
  );

  const longTermDebt = num(bs.longTermDebt, 0);
  const otherNonCurrentLiabilities = num(bs.otherNonCurrentLiabilities, 0);
  const nonCurrentLiabilities = num(
    bs.nonCurrentLiabilities,
    longTermDebt + otherNonCurrentLiabilities
  );

  const totalLiabilities = num(bs.totalLiabilities, currentLiabilities + nonCurrentLiabilities);
  const totalEquity = num(bs.totalEquity, totalAssets - totalLiabilities);

  return {
    currentAssets,
    cash,
    receivables,
    nonCurrentAssets,
    totalAssets,
    payables,
    shortTermDebt,
    currentLiabilities,
    longTermDebt,
    nonCurrentLiabilities,
    totalLiabilities,
    totalEquity,
  };
}

/**
 * Normalizes one raw period input into the figures the engine needs, applying
 * defaults for optional fields.
 */
function normalizePeriod(period) {
  if (!period || typeof period !== "object") {
    throw new TypeError("Each period must be an object");
  }
  const label = period.label ?? "(unlabeled)";

  const revenue = num(period.revenue);
  const cogs = num(period.cogs);
  const sga = num(period.sga);

  if (!period.costNature) {
    throw new Error(`Period "${label}" is missing required field costNature`);
  }
  const costNature = {
    wipFgChange: num(period.costNature.wipFgChange), // A: 제품과 재공품의 감소(증가)
    materialsUsed: num(period.costNature.materialsUsed), // B: 원재료 및 소모품 사용액
    merchandisePurchased: num(period.costNature.merchandisePurchased, 0), // C: 상품의 매입액
  };

  if (!period.inventory) {
    throw new Error(`Period "${label}" is missing required field inventory`);
  }
  const inventory = {
    wcaiEnd: num(period.inventory.wcaiEnd), // 가공비배부재고자산 (제품+재공품) 기말
    contractAssetEnd: num(period.inventory.contractAssetEnd, 0), // 계약자산 기말
  };

  const nonOperating = {
    otherIncomeExpense: num(period.nonOperating?.otherIncomeExpense, 0),
    financialIncomeExpense: num(period.nonOperating?.financialIncomeExpense, 0),
    equityMethodGainLoss: num(period.nonOperating?.equityMethodGainLoss, 0),
  };

  const interestPaid = num(period.interestPaid, 0);
  const taxExpense = num(period.taxExpense, 0);

  const incomeAdj = {
    discontinuedOps: num(period.comprehensiveIncomeAdjustments?.discontinuedOps, 0),
    oci: num(period.comprehensiveIncomeAdjustments?.oci, 0),
    accountingPolicyChange: num(period.comprehensiveIncomeAdjustments?.accountingPolicyChange, 0),
    ani: num(period.comprehensiveIncomeAdjustments?.ani, 0),
  };

  if (!period.balanceSheet) {
    throw new Error(`Period "${label}" is missing required field balanceSheet`);
  }
  const balanceSheet = normalizeBalanceSheet(period.balanceSheet);

  return {
    label,
    revenue,
    cogs,
    sga,
    costNature,
    inventory,
    nonOperating,
    interestPaid,
    taxExpense,
    incomeAdj,
    balanceSheet,
    employees: period.employees ?? null,
    laborCost: period.laborCost !== undefined ? num(period.laborCost) : null,
  };
}

/**
 * Legacy (absorption) cost P&L, reconstructed from standard FS line items.
 */
function legacyCostPL(p) {
  const grossProfit = p.revenue - p.cogs;
  const operatingProfit = grossProfit - p.sga;
  const nonOperatingNet =
    p.nonOperating.otherIncomeExpense +
    p.nonOperating.financialIncomeExpense +
    p.nonOperating.equityMethodGainLoss;
  const pretaxProfit = operatingProfit + nonOperatingNet;
  const netProfit = pretaxProfit - p.taxExpense;
  const effectiveTaxRate = safeDiv(p.taxExpense, pretaxProfit);
  const totalComprehensiveIncome =
    netProfit + p.incomeAdj.discontinuedOps + p.incomeAdj.oci + p.incomeAdj.accountingPolicyChange;

  return {
    revenue: p.revenue,
    cogs: p.cogs,
    grossProfit,
    grossMargin: safeDiv(grossProfit, p.revenue),
    sga: p.sga,
    sgaRatio: safeDiv(p.sga, p.revenue),
    operatingProfit,
    operatingMargin: safeDiv(operatingProfit, p.revenue),
    nonOperatingNet,
    pretaxProfit,
    taxExpense: p.taxExpense,
    effectiveTaxRate,
    netProfit,
    totalComprehensiveIncome,
  };
}

/**
 * Throughput P&L: reconstructs T (Throughput), OE (Operating Expense) and
 * Throughput Operating Profit from cost-by-nature + WCAI/contract-asset data.
 *
 * MC  (Material Cost, by nature)      = A + B + C
 * WC  (Working Cost / factory OE)      = COGS - MC
 * Comprehensive WCAI                   = WCAI + Contract Asset
 * Total Manufacturing Cost (Q)         = COGS + delta(Comprehensive WCAI)
 * Production Material Cost (Q)         = Total Manufacturing Cost (Q) - WC
 * Sales Material Cost (TVC on P&L)     = Production Material Cost (Q) * COGS / Total Manufacturing Cost (Q)
 * T (Throughput)                       = Revenue - Sales Material Cost
 * OE (Operating Expense)               = WC + SGA
 * Throughput Operating Profit          = T - OE
 */
function throughputPL(p, prior) {
  const mc = p.costNature.wipFgChange + p.costNature.materialsUsed + p.costNature.merchandisePurchased;
  const wc = p.cogs - mc; // 현장운영경비 (가공비)

  const comprehensiveWcaiEnd = p.inventory.wcaiEnd + p.inventory.contractAssetEnd;
  const comprehensiveWcaiBegin = prior
    ? prior.inventory.wcaiEnd + prior.inventory.contractAssetEnd
    : p.opening?.comprehensiveWcaiBegin ?? null;

  let totalManufacturingCost = null;
  let productionMaterialCost = null;
  let salesMaterialCost = null;
  let throughput = null;
  let note = null;

  if (comprehensiveWcaiBegin !== null) {
    const deltaWcai = comprehensiveWcaiEnd - comprehensiveWcaiBegin;
    totalManufacturingCost = p.cogs + deltaWcai;
    productionMaterialCost = totalManufacturingCost - wc;
    salesMaterialCost = totalManufacturingCost
      ? productionMaterialCost * (p.cogs / totalManufacturingCost)
      : productionMaterialCost;
    throughput = p.revenue - salesMaterialCost;
  } else {
    note =
      "No prior-period WCAI and no opening.comprehensiveWcaiBegin supplied: " +
      "Throughput P&L cannot be computed for this period (falls back to COGS as a rough TVC proxy).";
    salesMaterialCost = p.cogs;
    throughput = p.revenue - salesMaterialCost;
  }

  const oe = wc + p.sga;
  const throughputOperatingProfit = throughput - oe;

  // Secondary data-quality cross-check: an independent ("P") derivation of the
  // production material cost, using (B+C) directly rather than the WCAI delta.
  const productionMaterialCostAlt = p.costNature.materialsUsed + p.costNature.merchandisePurchased;
  const gapCheck =
    productionMaterialCost !== null ? productionMaterialCostAlt - productionMaterialCost : null;

  return {
    materialCostByNature: mc,
    workingCost: wc,
    comprehensiveWcaiEnd,
    comprehensiveWcaiBegin,
    totalManufacturingCost,
    productionMaterialCost,
    salesMaterialCost,
    throughput,
    throughputRate: safeDiv(throughput, p.revenue),
    oe,
    oeRate: safeDiv(oe, p.revenue),
    productivityTOE: safeDiv(throughput, oe),
    throughputOperatingProfit,
    throughputOperatingMargin: safeDiv(throughputOperatingProfit, p.revenue),
    dataQualityCheck: {
      productionMaterialCostAlt,
      gap: gapCheck,
      note:
        gapCheck !== null
          ? "gap = (B+C) - Q-derived production material cost; should be close to A (WIP/FG change) if the cost-nature note and inventory note are consistent."
          : null,
    },
    note,
  };
}

/**
 * ROI / capital productivity metrics requiring balance-sheet data.
 */
function capitalMetrics(p, tpl) {
  const bs = p.balanceSheet;
  const interestBearingDebt = bs.shortTermDebt + bs.longTermDebt;
  const nonInterestBearingLiabilities = bs.totalLiabilities - interestBearingDebt;
  const investedCapital = bs.totalAssets - nonInterestBearingLiabilities;

  const roic = safeDiv(tpl.throughputOperatingProfit, investedCapital);
  const interestCoverage = safeDiv(tpl.throughputOperatingProfit, p.interestPaid);
  const dupontMargin = tpl.throughputOperatingMargin;
  const dupontTurnover = safeDiv(p.revenue, bs.totalEquity);
  const dupontROI = dupontMargin !== null && dupontTurnover !== null ? dupontMargin * dupontTurnover : null;
  const totalAssetTurnover = safeDiv(p.revenue, bs.totalAssets);

  const wcaiTurn = safeDiv(p.cogs, tpl.comprehensiveWcaiEnd);
  const roiInventory = safeDiv(tpl.throughputOperatingProfit, tpl.comprehensiveWcaiEnd);

  const receivableTurnover = safeDiv(p.revenue, bs.receivables);
  const payableTurnover = safeDiv(p.cogs, bs.payables);
  const cashBufferRatio = safeDiv(bs.cash, p.cogs + p.sga);

  return {
    interestBearingDebt,
    nonInterestBearingLiabilities,
    investedCapital,
    roic,
    interestCoverage,
    dupontMargin,
    dupontTurnover,
    dupontROI,
    totalAssetTurnover,
    wcaiTurn,
    roiInventory,
    receivableTurnover,
    payableTurnover,
    cashBufferRatio,
  };
}

/**
 * AtMAN cash-flow indicators: EAT, EMS, FEM, FCFC, FCFE, FCFF, ROE.
 * Needs the prior period's balance sheet (or an `opening` snapshot on the
 * first period) to compute period-over-period cash-flow proxies.
 */
function cashFlowMetrics(p, legacy, prior) {
  const bs = p.balanceSheet;
  const priorBs = prior ? prior.balanceSheet : p.opening?.balanceSheet ?? null;

  const ebit = legacy.pretaxProfit + p.interestPaid;
  const ociPlusAni =
    p.incomeAdj.discontinuedOps + p.incomeAdj.oci + p.incomeAdj.accountingPolicyChange + p.incomeAdj.ani;
  const eat = legacy.netProfit + ociPlusAni + p.interestPaid;

  if (!priorBs) {
    return {
      ebit,
      eat,
      note:
        "No prior-period balance sheet and no opening.balanceSheet supplied: " +
        "cash-flow proxies (CBF, NWC_CF, CAPEX, EMS, FEM, FCFC, FCFE, FCFF, ROE) cannot be computed for this period.",
    };
  }

  const interestBearingDebt = bs.shortTermDebt + bs.longTermDebt;
  const nonInterestBearingLiabilities = bs.totalLiabilities - interestBearingDebt;
  const nwc = bs.currentAssets - nonInterestBearingLiabilities;

  const priorInterestBearingDebt = priorBs.shortTermDebt + priorBs.longTermDebt;
  const priorNonInterestBearingLiabilities = priorBs.totalLiabilities - priorInterestBearingDebt;
  const priorNwc = priorBs.currentAssets - priorNonInterestBearingLiabilities;

  const cashBufferFlow = bs.cash - priorBs.cash;
  const nwcCashFlow = priorNwc - nwc;
  const capex = priorBs.nonCurrentAssets - bs.nonCurrentAssets;

  const ems = cashBufferFlow + nwcCashFlow + eat;
  const fem = ems + capex - p.incomeAdj.ani;

  const investedCapital = bs.totalAssets - nonInterestBearingLiabilities;

  const fcfc = priorInterestBearingDebt - interestBearingDebt + p.interestPaid;
  const fcfe = priorBs.totalEquity - bs.totalEquity + legacy.totalComprehensiveIncome;
  const fcff = fcfc + fcfe;
  const roe = safeDiv(fcfe, investedCapital);

  const leverageRatio = safeDiv(interestBearingDebt, investedCapital);
  const cashInterestRate = safeDiv(p.interestPaid, interestBearingDebt);

  return {
    ebit,
    eat,
    cashBufferFlow,
    nwcCashFlow,
    capex,
    ems,
    fem,
    fcfc,
    fcfe,
    fcff,
    roe,
    leverageRatio,
    cashInterestRate,
    note: null,
  };
}

/**
 * Analyzes a chronologically-ordered list of period inputs and returns one
 * result object per period. periods[0] may carry an `opening` field with
 * { comprehensiveWcaiBegin, balanceSheet } so that flow metrics can be
 * computed even for the earliest period in the series.
 */
function analyzePeriods(rawPeriods) {
  if (!Array.isArray(rawPeriods) || rawPeriods.length === 0) {
    throw new TypeError("analyzePeriods expects a non-empty array of period inputs");
  }

  const normalized = rawPeriods.map((raw, i) => {
    const p = normalizePeriod(raw);
    if (i === 0 && raw.opening) {
      p.opening = {
        comprehensiveWcaiBegin:
          raw.opening.comprehensiveWcaiBegin !== undefined
            ? num(raw.opening.comprehensiveWcaiBegin)
            : undefined,
        balanceSheet: raw.opening.balanceSheet ? normalizeBalanceSheet(raw.opening.balanceSheet) : undefined,
      };
    }
    return p;
  });

  return normalized.map((p, i) => {
    const prior = i > 0 ? normalized[i - 1] : null;
    const legacy = legacyCostPL(p);
    const tpl = throughputPL(p, prior);
    const capital = capitalMetrics(p, tpl);
    const cashFlow = cashFlowMetrics(p, legacy, prior);

    return {
      label: p.label,
      legacyCostPL: legacy,
      throughputPL: tpl,
      capitalMetrics: capital,
      cashFlowMetrics: cashFlow,
    };
  });
}

module.exports = {
  analyzePeriods,
  normalizePeriod,
  normalizeBalanceSheet,
  legacyCostPL,
  throughputPL,
  capitalMetrics,
  cashFlowMetrics,
};
