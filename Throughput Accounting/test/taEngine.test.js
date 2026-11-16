"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzePeriods, normalizeBalanceSheet } = require("../src/taEngine");

function closeTo(actual, expected, eps = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} to be close to ${expected}`
  );
}

test("normalizeBalanceSheet derives totals that are not supplied directly", () => {
  const bs = normalizeBalanceSheet({
    currentAssets: 100,
    cash: 10,
    receivables: 20,
    nonCurrentAssets: 200,
    payables: 30,
    shortTermDebt: 10,
    longTermDebt: 40,
  });
  assert.equal(bs.totalAssets, 300);
  assert.equal(bs.currentLiabilities, 40);
  assert.equal(bs.nonCurrentLiabilities, 40);
  assert.equal(bs.totalLiabilities, 80);
  assert.equal(bs.totalEquity, 220);
});

test("throughput P&L: T - OE matches Throughput Operating Profit, and OE = WC + SGA", () => {
  const [result] = analyzePeriods([
    {
      label: "P1",
      revenue: 100000,
      cogs: 75000,
      sga: 15000,
      costNature: { wipFgChange: 1000, materialsUsed: 50000, merchandisePurchased: 0 },
      inventory: { wcaiEnd: 7600 },
      interestPaid: 900,
      taxExpense: 2000,
      balanceSheet: {
        currentAssets: 60000,
        cash: 10000,
        receivables: 20000,
        nonCurrentAssets: 80000,
        payables: 15000,
        shortTermDebt: 10000,
        longTermDebt: 20000,
        totalEquity: 95000,
      },
      opening: { comprehensiveWcaiBegin: 7000 },
    },
  ]);

  const t = result.throughputPL;
  closeTo(t.oe, t.workingCost + 15000);
  closeTo(t.throughputOperatingProfit, t.throughput - t.oe);
  closeTo(t.throughput, 100000 - t.salesMaterialCost);

  // Total Manufacturing Cost (Q) = COGS + delta(comprehensive WCAI)
  closeTo(t.totalManufacturingCost, 75000 + (7600 - 7000));
  // Sales material cost prorates production material cost by COGS / TMC
  closeTo(
    t.salesMaterialCost,
    t.productionMaterialCost * (75000 / t.totalManufacturingCost)
  );
});

test("legacy and throughput P&L agree when there is no WCAI movement and no WIP/FG change", () => {
  // With zero delta-WCAI, Total Manufacturing Cost (Q) == COGS, so
  // Sales Material Cost == Production Material Cost == COGS - WC, and WC == COGS - MC.
  // With wipFgChange = 0, MC == materialsUsed, so this isolates the relationship cleanly.
  const [result] = analyzePeriods([
    {
      label: "P1",
      revenue: 100000,
      cogs: 60000,
      sga: 10000,
      costNature: { wipFgChange: 0, materialsUsed: 40000, merchandisePurchased: 0 },
      inventory: { wcaiEnd: 5000 },
      balanceSheet: {
        currentAssets: 50000,
        cash: 5000,
        receivables: 15000,
        nonCurrentAssets: 50000,
        payables: 10000,
        shortTermDebt: 5000,
        longTermDebt: 10000,
        totalEquity: 75000,
      },
      opening: { comprehensiveWcaiBegin: 5000 },
    },
  ]);

  const t = result.throughputPL;
  closeTo(t.totalManufacturingCost, 60000);
  closeTo(t.workingCost, 60000 - 40000); // WC = COGS - MC
  closeTo(t.salesMaterialCost, 40000); // no proration needed, TMC == COGS
  closeTo(t.throughput, 100000 - 40000);
  closeTo(t.oe, 20000 + 10000);
});

test("cash-flow metrics (AtMAN) use opening balance sheet for the first period", () => {
  const [result] = analyzePeriods([
    {
      label: "P1",
      revenue: 100000,
      cogs: 75000,
      sga: 15000,
      costNature: { wipFgChange: 1000, materialsUsed: 50000, merchandisePurchased: 0 },
      inventory: { wcaiEnd: 7600 },
      interestPaid: 900,
      taxExpense: 2000,
      balanceSheet: {
        currentAssets: 60000,
        cash: 10000,
        receivables: 20000,
        nonCurrentAssets: 80000,
        payables: 15000,
        shortTermDebt: 10000,
        longTermDebt: 20000,
        totalEquity: 95000,
      },
      opening: {
        comprehensiveWcaiBegin: 7000,
        balanceSheet: {
          currentAssets: 55000,
          cash: 9000,
          receivables: 18000,
          nonCurrentAssets: 75000,
          payables: 14000,
          shortTermDebt: 9000,
          longTermDebt: 18000,
          totalEquity: 89000,
        },
      },
    },
  ]);

  const cf = result.cashFlowMetrics;
  assert.equal(cf.note, null);
  closeTo(cf.cashBufferFlow, 10000 - 9000);
  closeTo(cf.fcff, cf.fcfc + cf.fcfe);
  assert.ok(Number.isFinite(cf.ems));
  assert.ok(Number.isFinite(cf.fem));
});

test("missing prior-period data yields explanatory nulls instead of throwing", () => {
  const [result] = analyzePeriods([
    {
      label: "P1 (no opening)",
      revenue: 100000,
      cogs: 75000,
      sga: 15000,
      costNature: { wipFgChange: 1000, materialsUsed: 50000, merchandisePurchased: 0 },
      inventory: { wcaiEnd: 7600 },
      balanceSheet: {
        currentAssets: 60000,
        cash: 10000,
        receivables: 20000,
        nonCurrentAssets: 80000,
        payables: 15000,
        shortTermDebt: 10000,
        longTermDebt: 20000,
        totalEquity: 95000,
      },
    },
  ]);

  assert.ok(result.throughputPL.note); // WCAI delta unavailable
  assert.ok(result.cashFlowMetrics.note); // no prior/opening balance sheet
  assert.equal(result.cashFlowMetrics.ems, undefined);
});

test("rejects a period missing required fields with a clear error", () => {
  assert.throws(
    () => analyzePeriods([{ label: "bad" }]),
    /missing required field/
  );
});

test("second period in a series derives its prior from periods[i-1] automatically", () => {
  const results = analyzePeriods([
    {
      label: "2023",
      revenue: 100000,
      cogs: 75000,
      sga: 15000,
      costNature: { wipFgChange: 1000, materialsUsed: 50000, merchandisePurchased: 0 },
      inventory: { wcaiEnd: 7600 },
      balanceSheet: {
        currentAssets: 60000,
        cash: 10000,
        receivables: 20000,
        nonCurrentAssets: 80000,
        payables: 15000,
        shortTermDebt: 10000,
        longTermDebt: 20000,
        totalEquity: 95000,
      },
      opening: {
        comprehensiveWcaiBegin: 7000,
        balanceSheet: {
          currentAssets: 55000,
          cash: 9000,
          receivables: 18000,
          nonCurrentAssets: 75000,
          payables: 14000,
          shortTermDebt: 9000,
          longTermDebt: 18000,
          totalEquity: 89000,
        },
      },
    },
    {
      label: "2024",
      revenue: 115000,
      cogs: 84000,
      sga: 16500,
      costNature: { wipFgChange: 800, materialsUsed: 56000, merchandisePurchased: 0 },
      inventory: { wcaiEnd: 8200 },
      balanceSheet: {
        currentAssets: 66000,
        cash: 12000,
        receivables: 22000,
        nonCurrentAssets: 84000,
        payables: 16000,
        shortTermDebt: 9000,
        longTermDebt: 19000,
        totalEquity: 106000,
      },
    },
  ]);

  const [p2023, p2024] = results;
  assert.equal(p2023.throughputPL.note, null);
  assert.equal(p2024.throughputPL.note, null);
  closeTo(p2024.throughputPL.comprehensiveWcaiBegin, p2023.throughputPL.comprehensiveWcaiEnd);
  assert.equal(p2024.cashFlowMetrics.note, null);
});
