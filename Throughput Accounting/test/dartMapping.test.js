"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveField } = require("../src/dart/accounts");
const { resolveAllFields, buildDraftPeriod } = require("../src/dart/mapToTaInput");

function row(sj_div, overrides) {
  return {
    sj_div,
    account_id: "-표준계정코드 미사용-",
    account_nm: "",
    thstrm_amount: "",
    thstrm_add_amount: "",
    frmtrm_amount: "",
    frmtrm_add_amount: "",
    ...overrides,
  };
}

test("resolveField prefers account_id over account_nm matching", () => {
  const rows = [
    row("IS", { account_id: "ifrs-full_Revenue", account_nm: "매출액", thstrm_amount: "1,000" }),
  ];
  const def = { sjDiv: "IS", ids: ["ifrs-full_Revenue"], names: ["매출"] };
  const hit = resolveField(rows, def, "thstrm_amount");
  assert.equal(hit.value, 1000);
  assert.equal(hit.matchedVia, "account_id");
});

test("resolveField falls back to exact then substring account_nm match", () => {
  const exactRows = [row("IS", { account_nm: "판매비와관리비", thstrm_amount: "500" })];
  const exactDef = { sjDiv: "IS", ids: [], names: ["판매비와관리비"] };
  assert.equal(resolveField(exactRows, exactDef, "thstrm_amount").matchedVia, "account_nm (exact)");

  const subRows = [row("IS", { account_nm: "판매비와관리비 등", thstrm_amount: "500" })];
  const subDef = { sjDiv: "IS", ids: [], names: ["판매비와관리비"] };
  assert.equal(resolveField(subRows, subDef, "thstrm_amount").matchedVia, "account_nm (substring)");
});

test("resolveField respects sj_div and returns null when nothing matches", () => {
  const rows = [row("BS", { account_nm: "매출액", thstrm_amount: "1" })];
  const def = { sjDiv: "IS", ids: [], names: ["매출액"] };
  assert.equal(resolveField(rows, def, "thstrm_amount"), null);
});

test("resolveAllFields + buildDraftPeriod maps a minimal synthetic DART filing", () => {
  const rows = [
    row("IS", { account_id: "ifrs-full_Revenue", thstrm_amount: "100,000", frmtrm_amount: "90,000" }),
    row("IS", { account_id: "ifrs-full_CostOfSales", thstrm_amount: "75,000", frmtrm_amount: "70,000" }),
    row("IS", { account_nm: "판매비와관리비", thstrm_amount: "15,000", frmtrm_amount: "14,000" }),
    row("IS", {
      account_id: "ifrs-full_IncomeTaxExpenseContinuingOperations",
      thstrm_amount: "2,000",
      frmtrm_amount: "1,800",
    }),
    row("BS", { account_id: "ifrs-full_CurrentAssets", thstrm_amount: "60,000", frmtrm_amount: "55,000" }),
    row("BS", {
      account_id: "ifrs-full_CashAndCashEquivalents",
      thstrm_amount: "10,000",
      frmtrm_amount: "9,000",
    }),
    row("BS", { account_id: "ifrs-full_Equity", thstrm_amount: "95,000", frmtrm_amount: "89,000" }),
  ];

  const { resolved: current, unresolved } = resolveAllFields(rows, "current", true);
  assert.equal(current.revenue, 100000);
  assert.equal(current.cogs, 75000);
  assert.equal(current.sga, 15000);
  assert.equal(current.incomeTaxExpense, 2000);
  assert.equal(current.currentAssets, 60000);
  assert.ok(unresolved.some((u) => u.field === "nonCurrentAssets"));

  const { resolved: prior } = resolveAllFields(rows, "prior", true);
  assert.equal(prior.revenue, 90000);
  assert.equal(prior.currentAssets, 55000);

  const draft = buildDraftPeriod({ label: "2024", current, priorBalanceSheetOnly: prior, employeeStatus: null });
  assert.equal(draft.revenue, 100000);
  assert.equal(draft.cogs, 75000);
  assert.equal(draft.sga, 15000);
  assert.equal(draft.taxExpense, 2000);
  // Fields DART's standard statement API cannot supply stay explicitly null,
  // never silently defaulted to something plausible-looking.
  assert.equal(draft.costNature.wipFgChange, null);
  assert.equal(draft.costNature.materialsUsed, null);
  assert.equal(draft.inventory.wcaiEnd, null);
  assert.equal(draft.opening.balanceSheet.currentAssets, 55000);
  assert.equal(draft.opening.comprehensiveWcaiBegin, null);
});

test("buildDraftPeriod combines otherIncome/otherExpenses into a net nonOperating figure", () => {
  const current = {
    revenue: 1, cogs: 1, sga: 1,
    otherIncome: 300, otherExpenses: 100,
    financeIncome: 50, financeCosts: 20,
    shareOfAssociatesProfit: 10,
    incomeTaxExpense: null, oci: null,
    interestPaidCF: null, depreciationCF: null, amortisationCF: null,
    currentAssets: null, cash: null, receivables: null, nonCurrentAssets: null, totalAssets: null,
    payables: null, shortTermDebt: null, currentLiabilities: null, longTermDebt: null,
    nonCurrentLiabilities: null, totalLiabilities: null, totalEquity: null,
  };
  const draft = buildDraftPeriod({ label: "X", current, priorBalanceSheetOnly: null, employeeStatus: null });
  assert.equal(draft.nonOperating.otherIncomeExpense, 200); // 300 - 100
  assert.equal(draft.nonOperating.financialIncomeExpense, 30); // 50 - 20
  assert.equal(draft.nonOperating.equityMethodGainLoss, 10);
  assert.equal(draft.opening, undefined);
});
