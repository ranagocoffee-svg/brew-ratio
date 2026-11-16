"use strict";

/**
 * Maps DART's `fnlttSinglAcntAll` rows to the figures our TA engine needs.
 * DART rows are tagged with an XBRL standard `account_id` when the filer
 * used a standard taxonomy element, and always carry a Korean `account_nm`
 * label. Since many Korean filers use non-standard/custom tags for at least
 * some lines, every field here tries standard IDs first, then falls back to
 * matching the Korean label.
 */

const norm = (s) => (s || "").replace(/\s+/g, "");

const FIELD_DEFS = {
  revenue: {
    sjDiv: "IS",
    ids: ["ifrs-full_Revenue", "ifrs-full_RevenueFromContractsWithCustomers"],
    names: ["매출액", "매출"],
  },
  cogs: {
    sjDiv: "IS",
    ids: ["ifrs-full_CostOfSales"],
    names: ["매출원가"],
  },
  sga: {
    sjDiv: "IS",
    ids: ["dart_TotalSellingGeneralAdministrativeExpenses"],
    names: ["판매비와관리비"],
  },
  financeIncome: {
    sjDiv: "IS",
    ids: ["ifrs-full_FinanceIncome"],
    names: ["금융수익"],
  },
  financeCosts: {
    sjDiv: "IS",
    ids: ["ifrs-full_FinanceCosts"],
    names: ["금융원가", "금융비용"],
  },
  otherIncome: {
    sjDiv: "IS",
    ids: ["ifrs-full_OtherIncome"],
    names: ["기타수익"],
  },
  otherExpenses: {
    sjDiv: "IS",
    ids: ["ifrs-full_OtherExpenses"],
    names: ["기타비용"],
  },
  shareOfAssociatesProfit: {
    sjDiv: "IS",
    ids: ["ifrs-full_ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod"],
    // Filers vary this label by year even within the same company (e.g. a
    // custom "관계기업및공동기업투자관련이익/손실" label one year, the
    // standard IFRS tag the next), so match on the common stem rather than
    // a full label - substring matching then catches all variants.
    names: ["관계기업및공동기업투자", "지분법", "관계기업등의순이익에대한지분"],
  },
  incomeTaxExpense: {
    sjDiv: "IS",
    ids: ["ifrs-full_IncomeTaxExpenseContinuingOperations"],
    names: ["법인세비용"],
  },
  netProfit: {
    sjDiv: "IS",
    ids: ["ifrs-full_ProfitLoss"],
    names: ["당기순이익(손실)", "당기순이익"],
  },
  oci: {
    sjDiv: "CIS",
    ids: ["ifrs-full_OtherComprehensiveIncome"],
    names: ["기타포괄손익"],
  },

  currentAssets: { sjDiv: "BS", ids: ["ifrs-full_CurrentAssets"], names: ["유동자산"] },
  cash: { sjDiv: "BS", ids: ["ifrs-full_CashAndCashEquivalents"], names: ["현금및현금성자산"] },
  receivables: {
    sjDiv: "BS",
    ids: ["ifrs-full_TradeAndOtherCurrentReceivables", "ifrs-full_CurrentTradeReceivables"],
    names: ["매출채권및기타수취채권", "매출채권"],
  },
  inventoriesBS: { sjDiv: "BS", ids: ["ifrs-full_Inventories"], names: ["재고자산"] },
  nonCurrentAssets: { sjDiv: "BS", ids: ["ifrs-full_NoncurrentAssets"], names: ["비유동자산"] },
  totalAssets: { sjDiv: "BS", ids: ["ifrs-full_Assets"], names: ["자산총계"] },
  currentLiabilities: { sjDiv: "BS", ids: ["ifrs-full_CurrentLiabilities"], names: ["유동부채"] },
  payables: {
    sjDiv: "BS",
    ids: ["ifrs-full_TradeAndOtherCurrentPayables"],
    names: ["매입채무및기타채무", "매입채무"],
  },
  shortTermDebt: {
    sjDiv: "BS",
    ids: [
      "ifrs-full_ShorttermBorrowings",
      "ifrs-full_CurrentPortionOfLongtermBorrowings",
      // Some filers report the short-term and current-portion-of-long-term
      // pieces as one combined line under this tag instead of splitting them.
      "ifrs-full_CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings",
    ],
    names: ["단기차입금", "유동차입금"],
  },
  nonCurrentLiabilities: { sjDiv: "BS", ids: ["ifrs-full_NoncurrentLiabilities"], names: ["비유동부채"] },
  longTermDebt: {
    sjDiv: "BS",
    ids: ["ifrs-full_NoncurrentBorrowings", "ifrs-full_LongtermBorrowings"],
    names: ["장기차입금"],
  },
  totalLiabilities: { sjDiv: "BS", ids: ["ifrs-full_Liabilities"], names: ["부채총계"] },
  totalEquity: { sjDiv: "BS", ids: ["ifrs-full_Equity"], names: ["자본총계"] },

  interestPaidCF: { sjDiv: "CF", ids: [], names: ["이자의지급"] },
  depreciationCF: {
    sjDiv: "CF",
    ids: ["ifrs-full_DepreciationExpense", "ifrs-full_DepreciationAndAmortisationExpense"],
    names: ["감가상각비"],
  },
  amortisationCF: { sjDiv: "CF", ids: ["ifrs-full_AmortisationExpense"], names: ["무형자산상각비"] },
};

function parseAmount(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

/**
 * Resolves one field from a set of DART rows for a single period column
 * ("thstrm_amount", "thstrm_add_amount", or "frmtrm_amount").
 */
function resolveField(rows, def, amountKey) {
  const candidates = rows.filter((r) => r.sj_div === def.sjDiv);

  for (const id of def.ids) {
    const row = candidates.find((r) => r.account_id === id);
    if (row) {
      const value = parseAmount(row[amountKey]);
      if (value !== null) return { value, matchedVia: "account_id", accountNm: row.account_nm };
    }
  }

  for (const name of def.names) {
    const row = candidates.find((r) => norm(r.account_nm) === norm(name));
    if (row) {
      const value = parseAmount(row[amountKey]);
      if (value !== null) return { value, matchedVia: "account_nm (exact)", accountNm: row.account_nm };
    }
  }

  for (const name of def.names) {
    const row = candidates.find((r) => norm(r.account_nm).includes(norm(name)));
    if (row) {
      const value = parseAmount(row[amountKey]);
      if (value !== null) return { value, matchedVia: "account_nm (substring)", accountNm: row.account_nm };
    }
  }

  return null;
}

module.exports = { FIELD_DEFS, resolveField, parseAmount, norm };
