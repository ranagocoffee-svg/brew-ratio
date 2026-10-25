"use strict";

const { fetchFinancialStatements, fetchEmployeeStatus } = require("./client");
const { resolveAllFields, buildDraftPeriod } = require("./mapToTaInput");

const MANUAL_FIELDS = [
  "costNature.wipFgChange",
  "costNature.materialsUsed",
  "inventory.wcaiEnd",
];

/**
 * Sums 직원현황(empSttus) rows into a single headcount + annual labor cost.
 * Rows are broken down by 사업부문/성별; DART does not return a separate
 * grand-total row in the normal case, so a plain sum is the right default,
 * but the caller should sanity-check against the filing if it looks off.
 */
function summarizeEmployeeStatus(rows) {
  if (!rows.length) return null;
  let employees = 0;
  let laborCost = 0;
  let any = false;
  for (const row of rows) {
    const sm = Number(String(row.sm || "").replace(/,/g, ""));
    const pay = Number(String(row.fyer_salary_totamt || "").replace(/,/g, ""));
    if (!Number.isNaN(sm)) {
      employees += sm;
      any = true;
    }
    if (!Number.isNaN(pay)) laborCost += pay;
  }
  return any ? { employees, laborCost } : null;
}

/**
 * Fetches and maps one period. `includeOpening` should be true only for the
 * earliest period in a multi-year request, so the engine has a prior-period
 * balance sheet to compute deltas against (taken from this same call's
 * frmtrm_amount columns).
 */
async function fetchPeriod({ apiKey, corpCode, year, reprtCode, fsDiv, label, includeOpening }) {
  const rows = await fetchFinancialStatements({ apiKey, corpCode, year, reprtCode, fsDiv });
  const isAnnual = reprtCode === "11011";

  const { resolved: current, unresolved } = resolveAllFields(rows, "current", isAnnual);
  const { resolved: prior } = resolveAllFields(rows, "prior", isAnnual);

  let employeeStatus = null;
  try {
    const empRows = await fetchEmployeeStatus({ apiKey, corpCode, year, reprtCode });
    employeeStatus = summarizeEmployeeStatus(empRows);
  } catch {
    // Employee status is a nice-to-have; absence (e.g. non-listed filer, no
    // data for this report type) should not fail the whole fetch.
  }

  const period = buildDraftPeriod({
    label,
    current,
    priorBalanceSheetOnly: includeOpening ? prior : null,
    employeeStatus,
  });

  const manualFields = [...MANUAL_FIELDS];
  if (includeOpening) manualFields.push("opening.comprehensiveWcaiBegin");

  return {
    period,
    warnings: {
      unresolvedFromDart: unresolved,
      manualFieldsRequired: manualFields,
      employeeStatusFound: Boolean(employeeStatus),
      aniIsDepreciationProxyOnly: true,
    },
  };
}

/**
 * Fetches a chronologically-ordered series of periods (oldest first).
 * `years` is an array of { year, reprtCode, label }.
 */
async function fetchPeriods({ apiKey, corpCode, fsDiv, years }) {
  const results = [];
  for (let i = 0; i < years.length; i++) {
    const { year, reprtCode, label } = years[i];
    const result = await fetchPeriod({
      apiKey,
      corpCode,
      year,
      reprtCode,
      fsDiv,
      label: label || `${year}`,
      includeOpening: i === 0,
    });
    results.push(result);
  }
  return results;
}

module.exports = { fetchPeriod, fetchPeriods, summarizeEmployeeStatus };
