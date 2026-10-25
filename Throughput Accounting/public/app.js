"use strict";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (HTTP ${res.status})`);
  return data;
}

function setStatus(message, kind = "") {
  const s = $("status");
  s.textContent = message;
  s.className = `status ${kind}`;
}

// ---------- field schema ----------
const BS_FIELDS = [
  ["currentAssets", "유동자산"],
  ["cash", "현금및현금성자산"],
  ["receivables", "매출채권"],
  ["nonCurrentAssets", "비유동자산"],
  ["totalAssets", "자산총계 (비우면 자동계산)"],
  ["payables", "매입채무"],
  ["shortTermDebt", "단기차입금(유동성 포함)"],
  ["currentLiabilities", "유동부채 (비우면 자동계산)"],
  ["longTermDebt", "장기차입금"],
  ["nonCurrentLiabilities", "비유동부채 (비우면 자동계산)"],
  ["totalLiabilities", "부채총계 (비우면 자동계산)"],
  ["totalEquity", "자본총계"],
];

const FIELD_GROUPS = [
  {
    title: "손익계산서",
    fields: [
      { path: "revenue", label: "매출" },
      { path: "cogs", label: "매출원가" },
      { path: "sga", label: "판매비와관리비" },
      { path: "taxExpense", label: "법인세비용" },
      { path: "interestPaid", label: "지급이자" },
    ],
  },
  {
    title: "비용의 성격별 분류 (주석)",
    fields: [
      { path: "costNature.wipFgChange", label: "제품과 재공품의 감소(증가)", manual: true },
      { path: "costNature.materialsUsed", label: "원재료 및 소모품 사용액", manual: true },
      { path: "costNature.merchandisePurchased", label: "상품의 매입액" },
    ],
  },
  {
    title: "재고자산 (주석)",
    fields: [
      { path: "inventory.wcaiEnd", label: "WCAI 기말 (제품+재공품)", manual: true },
      { path: "inventory.contractAssetEnd", label: "계약자산 기말" },
    ],
  },
  {
    title: "영업외손익 · 포괄손익",
    fields: [
      { path: "nonOperating.otherIncomeExpense", label: "기타손익(순)" },
      { path: "nonOperating.financialIncomeExpense", label: "금융손익(순)" },
      { path: "nonOperating.equityMethodGainLoss", label: "관계기업등 지분법손익" },
      { path: "comprehensiveIncomeAdjustments.oci", label: "기타포괄손익(OCI)" },
      { path: "comprehensiveIncomeAdjustments.ani", label: "비현금조정(ANI)" },
    ],
  },
  {
    title: "인력",
    fields: [
      { path: "employees", label: "직원 수" },
      { path: "laborCost", label: "인건비(연간 급여총액)" },
    ],
  },
  {
    title: "재무상태표 (기말)",
    fields: BS_FIELDS.map(([k, label]) => ({ path: `balanceSheet.${k}`, label })),
  },
];

const OPENING_GROUP = {
  title: "기초(직전 기말) 값 — 첫 기간만",
  fields: [
    { path: "opening.comprehensiveWcaiBegin", label: "기초 WCAI (직전 기말 제품+재공품)", manual: true },
    ...BS_FIELDS.map(([k, label]) => ({ path: `opening.balanceSheet.${k}`, label: `기초 ${label}` })),
  ],
};

// ---------- state ----------
const state = { periods: [], warnings: [], results: null, corp: null };

function parseNumber(text) {
  const cleaned = String(text).replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? NaN : n;
}

// ---------- source tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      const active = t === tab;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", String(active));
    });
    $("panel-dart").hidden = tab.dataset.tab !== "dart";
    $("panel-json").hidden = tab.dataset.tab !== "json";
  });
});

// ---------- DART lookup ----------
let selectedCorp = null;

async function lookupCompany() {
  const q = $("company-query").value.trim();
  if (!q) return setStatus("회사명을 입력하세요.", "error");
  const btn = $("btn-lookup");
  btn.disabled = true;
  setStatus("회사 검색 중…");
  try {
    const params = new URLSearchParams({ q });
    if ($("api-key").value.trim()) params.set("apiKey", $("api-key").value.trim());
    const { matches } = await api(`/api/dart/lookup?${params}`);
    const box = $("lookup-results");
    box.replaceChildren();
    selectedCorp = null;
    if (matches.length === 0) return setStatus(`"${q}"와 일치하는 회사가 없습니다.`, "error");
    for (const m of matches) {
      const chip = el(
        "button",
        {
          class: "chip",
          type: "button",
          onclick: () => {
            selectedCorp = m;
            box.querySelectorAll(".chip").forEach((c) => c.classList.toggle("selected", c === chip));
          },
        },
        `${m.corpName}${m.stockCode ? ` (${m.stockCode})` : ""} · ${m.corpCode}`
      );
      box.append(chip);
    }
    if (matches.length === 1) box.firstChild.click();
    setStatus(`${matches.length}개 회사를 찾았습니다. 하나를 선택하세요.`, "ok");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function fetchFromDart() {
  const company = selectedCorp ? selectedCorp.corpCode : $("company-query").value.trim();
  if (!company) return setStatus("먼저 회사를 검색해 선택하세요.", "error");
  const years = $("years").value.split(",").map((s) => s.trim()).filter(Boolean);
  const btn = $("btn-fetch");
  btn.disabled = true;
  setStatus("DART에서 재무제표를 가져오는 중… (연도 수만큼 시간이 걸립니다)");
  try {
    const data = await api("/api/dart/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company,
        years,
        report: $("report").value,
        fs: $("fs").value,
        apiKey: $("api-key").value.trim() || undefined,
      }),
    });
    state.corp = data.corp;
    state.warnings = data.warnings;
    $("input-unit").value = "1"; // DART amounts are in KRW (원)
    loadPeriods(data.periods);
    const corpName = selectedCorp ? selectedCorp.corpName : data.corp.corpName;
    setStatus(`${corpName} · ${data.periods.length}개 기간을 가져왔습니다.`, "ok");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// ---------- JSON mode ----------
function loadJsonText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return setStatus("JSON 형식이 올바르지 않습니다.", "error");
  }
  const periods = Array.isArray(data) ? data : data.periods;
  if (!Array.isArray(periods) || periods.length === 0) {
    return setStatus('periods 배열이 필요합니다: [ ... ] 또는 {"periods": [ ... ]}', "error");
  }
  state.warnings = [];
  state.corp = null;
  loadPeriods(periods);
  setStatus(`${periods.length}개 기간을 불러왔습니다.`, "ok");
}

// ---------- edit form ----------
function loadPeriods(periods) {
  state.periods = periods;
  state.results = null;
  $("result-card").hidden = true;
  renderEditForm();
  $("edit-card").hidden = false;
  $("edit-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderWarnings() {
  const box = $("warnings");
  box.replaceChildren();
  const items = [];
  for (const w of state.warnings) {
    if (w.unresolvedFromDart?.length) {
      items.push(`${w.label}: DART에서 자동으로 찾지 못한 항목 — ${w.unresolvedFromDart.map((u) => u.field).join(", ")}`);
    }
    if (w.employeeStatusFound === false) items.push(`${w.label}: 직원현황 데이터를 찾지 못했습니다.`);
  }
  if (state.warnings.length) {
    items.push("ANI(비현금조정)는 현금흐름표의 감가상각비·무형자산상각비만 근사한 값이며, 없으면 비어 있습니다.");
  }
  if (items.length) {
    box.append(el("div", { class: "warn-box" }, "확인이 필요한 항목", el("ul", {}, items.map((t) => el("li", {}, t)))));
  }
}

function fieldInput(period, index, field) {
  const value = getPath(period, field.path);
  const input = el("input", {
    type: "text",
    inputmode: "decimal",
    value: value === null || value === undefined ? "" : String(value),
    "aria-label": `${period.label} ${field.label}`,
  });
  const label = el(
    "label",
    { class: field.manual && (value === null || value === undefined) ? "needs" : "" },
    el("span", {}, field.label, field.manual ? el("span", { class: "needs-badge" }, "필수") : null),
    input
  );
  input.addEventListener("input", () => {
    const n = parseNumber(input.value);
    setPath(period, field.path, n);
    label.classList.toggle("needs", Boolean(field.manual) && n === null);
    label.classList.toggle("invalid", Number.isNaN(n));
  });
  return label;
}

function renderEditForm() {
  renderWarnings();
  const container = $("periods");
  container.replaceChildren();

  state.periods.forEach((period, index) => {
    const groups = index === 0 ? [...FIELD_GROUPS, OPENING_GROUP] : FIELD_GROUPS;
    if (index === 0) {
      period.opening = period.opening || {};
      period.opening.balanceSheet = period.opening.balanceSheet || {};
    }
    const body = el("div", { class: "period-body" });
    for (const group of groups) {
      body.append(
        el("h4", { class: "group-title" }, group.title),
        el("div", { class: "fields" }, group.fields.map((f) => fieldInput(period, index, f)))
      );
    }
    container.append(
      el("details", { class: "period", open: index === state.periods.length - 1 }, el("summary", {}, period.label || `기간 ${index + 1}`), body)
    );
  });
}

// ---------- analysis ----------
function missingManualFields() {
  const missing = [];
  state.periods.forEach((p) => {
    for (const path of ["costNature.wipFgChange", "costNature.materialsUsed", "inventory.wcaiEnd"]) {
      const v = getPath(p, path);
      if (v === null || v === undefined || Number.isNaN(v)) missing.push(`${p.label}: ${path}`);
    }
  });
  return missing;
}

async function runAnalysis() {
  const missing = missingManualFields();
  if (missing.length) {
    return setStatus(`필수 입력값이 비어 있습니다: ${missing.join(", ")}`, "error");
  }
  const btn = $("btn-analyze");
  btn.disabled = true;
  try {
    // The input unit only affects display scaling; amounts go to the engine unchanged.
    const { results } = await api("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periods: state.periods }),
    });
    state.results = results;
    setStatus("분석이 완료되었습니다.", "ok");
    renderResults();
    $("result-card").hidden = false;
    $("result-card").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// ---------- results ----------
function displayFactor() {
  return Number($("input-unit").value) / Number($("display-unit").value);
}

const fmtNum = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const fmtRatio = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = new Intl.NumberFormat("ko-KR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

const money = (v) => (v === null || v === undefined || Number.isNaN(v) ? "-" : fmtNum.format(Math.round(v * displayFactor())));
const pct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : fmtPct.format(v));
const ratio = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : fmtRatio.format(v));

function signClass(v) {
  if (v === null || v === undefined || v === 0) return "";
  return v > 0 ? "pos" : "neg";
}

function table(headers, rows) {
  return el(
    "div",
    { class: "table-wrap" },
    el(
      "table",
      {},
      el("thead", {}, el("tr", {}, headers.map((h) => el("th", {}, h)))),
      el(
        "tbody",
        {},
        rows.map((r) =>
          el("tr", { class: r.em ? "em" : "" }, [
            el("td", {}, r.label),
            ...r.cells.map((c) => el("td", { class: c.cls || "" }, c.text)),
          ])
        )
      )
    )
  );
}

const cell = (text, cls) => ({ text, cls });

function renderResults() {
  const root = $("results");
  root.replaceChildren();
  const rs = state.results;
  if (!rs) return;

  // cross-period summary
  const unitName = $("display-unit").selectedOptions[0].textContent;
  root.append(
    el("h3", {}, `기간별 요약 (${unitName})`),
    table(
      ["지표", ...rs.map((r) => r.label)],
      [
        { label: "매출", cells: rs.map((r) => cell(money(r.legacyCostPL.revenue))) },
        { label: "Throughput (T)", em: true, cells: rs.map((r) => cell(money(r.throughputPL.throughput))) },
        { label: "T율 (T/매출)", cells: rs.map((r) => cell(pct(r.throughputPL.throughputRate))) },
        { label: "OE (운영경비)", cells: rs.map((r) => cell(money(r.throughputPL.oe))) },
        { label: "T/OE 생산성", cells: rs.map((r) => cell(ratio(r.throughputPL.productivityTOE))) },
        {
          label: "Throughput 영업이익",
          em: true,
          cells: rs.map((r) => cell(money(r.throughputPL.throughputOperatingProfit), signClass(r.throughputPL.throughputOperatingProfit))),
        },
        { label: "원가회계 영업이익", cells: rs.map((r) => cell(money(r.legacyCostPL.operatingProfit))) },
        { label: "ROIC", cells: rs.map((r) => cell(pct(r.capitalMetrics.roic))) },
        { label: "WCAI Turn", cells: rs.map((r) => cell(ratio(r.capitalMetrics.wcaiTurn))) },
      ]
    )
  );

  for (const r of rs) {
    const l = r.legacyCostPL;
    const t = r.throughputPL;
    const c = r.capitalMetrics;
    const cf = r.cashFlowMetrics;
    const gap = t.throughputOperatingProfit - l.operatingProfit;

    const section = el("div", { class: "result-period" }, el("h3", {}, r.label));

    section.append(
      el(
        "div",
        { class: "kpis" },
        kpi("Throughput (T)", money(t.throughput)),
        kpi("T율", pct(t.throughputRate)),
        kpi("T/OE 생산성", ratio(t.productivityTOE)),
        kpi("T 영업이익", money(t.throughputOperatingProfit), signClass(t.throughputOperatingProfit)),
        kpi("ROIC", pct(c.roic))
      )
    );
    if (t.note) section.append(el("p", { class: "note" }, t.note));

    section.append(
      el(
        "div",
        { class: "two-col" },
        el("div", {}, el("h4", { class: "group-title" }, "원가회계 손익 (Legacy)"), table(["항목", "금액", "비율"], [
          { label: "매출", cells: [cell(money(l.revenue)), cell("")] },
          { label: "매출원가", cells: [cell(money(l.cogs)), cell("")] },
          { label: "매출총이익", cells: [cell(money(l.grossProfit)), cell(pct(l.grossMargin))] },
          { label: "판관비", cells: [cell(money(l.sga)), cell(pct(l.sgaRatio))] },
          { label: "영업이익", em: true, cells: [cell(money(l.operatingProfit)), cell(pct(l.operatingMargin))] },
          { label: "법인세차감전순이익", cells: [cell(money(l.pretaxProfit)), cell("")] },
          { label: "당기순이익", cells: [cell(money(l.netProfit)), cell("")] },
        ])),
        el("div", {}, el("h4", { class: "group-title" }, "Throughput 손익"), table(["항목", "금액", "비율"], [
          { label: "매출", cells: [cell(money(l.revenue)), cell("")] },
          { label: "매출재료비 (TVC)", cells: [cell(money(t.salesMaterialCost)), cell("")] },
          { label: "Throughput (T)", em: true, cells: [cell(money(t.throughput)), cell(pct(t.throughputRate))] },
          { label: "현장운영경비 (가공비)", cells: [cell(money(t.workingCost)), cell("")] },
          { label: "OE 운영경비계", cells: [cell(money(t.oe)), cell(pct(t.oeRate))] },
          { label: "T 영업이익", em: true, cells: [cell(money(t.throughputOperatingProfit), signClass(t.throughputOperatingProfit)), cell(pct(t.throughputOperatingMargin))] },
          { label: "원가영업이익과의 GAP", cells: [cell(money(gap), signClass(gap)), cell("")] },
        ]))
      )
    );

    section.append(
      el(
        "div",
        { class: "two-col" },
        el("div", {}, el("h4", { class: "group-title" }, "생산성 · ROI 지표"), table(["지표", "값"], [
          { label: "WCAI Turn (매출원가/포괄WCAI)", cells: [cell(ratio(c.wcaiTurn))] },
          { label: "ROI Inventory (T영업이익/포괄WCAI)", cells: [cell(pct(c.roiInventory))] },
          { label: `투하자본 (${unitName})`, cells: [cell(money(c.investedCapital))] },
          { label: "ROIC (T영업이익/투하자본)", cells: [cell(pct(c.roic))] },
          { label: "이자보상배율", cells: [cell(ratio(c.interestCoverage))] },
          { label: "듀퐁 ROI (P×T)", cells: [cell(pct(c.dupontROI))] },
          { label: "총자산회전율", cells: [cell(ratio(c.totalAssetTurnover))] },
          { label: "매출채권회전율", cells: [cell(ratio(c.receivableTurnover))] },
          { label: "매입채무회전율", cells: [cell(ratio(c.payableTurnover))] },
          { label: "Cash Buffer 비율", cells: [cell(pct(c.cashBufferRatio))] },
        ])),
        el("div", {}, el("h4", { class: "group-title" }, "AtMAN 현금흐름 지표"), cf.note
          ? el("p", { class: "note" }, cf.note)
          : null, table(["지표", `금액 (${unitName})`], [
          { label: "EBIT", cells: [cell(money(cf.ebit))] },
          { label: "EAT (세후현금순이익)", cells: [cell(money(cf.eat))] },
          ...(cf.note ? [] : [
            { label: "CBF (현금버퍼흐름)", cells: [cell(money(cf.cashBufferFlow), signClass(cf.cashBufferFlow))] },
            { label: "NWC_CF (순운전자본흐름)", cells: [cell(money(cf.nwcCashFlow), signClass(cf.nwcCashFlow))] },
            { label: "CAPEX (비유동자산흐름)", cells: [cell(money(cf.capex), signClass(cf.capex))] },
            { label: "EMS (Earned Money Sales)", em: true, cells: [cell(money(cf.ems), signClass(cf.ems))] },
            { label: "FEM (Final Earned Money)", em: true, cells: [cell(money(cf.fem), signClass(cf.fem))] },
            { label: "FCFC (채권자)", cells: [cell(money(cf.fcfc), signClass(cf.fcfc))] },
            { label: "FCFE (주주)", cells: [cell(money(cf.fcfe), signClass(cf.fcfe))] },
            { label: "FCFF (회사)", cells: [cell(money(cf.fcff), signClass(cf.fcff))] },
            { label: "ROE (FCFE/투하자본)", cells: [cell(pct(cf.roe))] },
          ]),
        ]))
      )
    );

    if (t.dataQualityCheck?.gap !== null && t.dataQualityCheck?.gap !== undefined) {
      section.append(
        el("p", { class: "note" }, `데이터 검증 GAP (원재료사용액+상품매입 − WCAI 증감 기준 생산재료비): ${money(t.dataQualityCheck.gap)} ${unitName} — 0에 가까울수록 주석 간 정합성이 높습니다.`)
      );
    }
    root.append(section);
  }
}

function kpi(label, value, cls = "") {
  return el("div", { class: "kpi" }, el("div", { class: "k-label" }, label), el("div", { class: `k-value ${cls}` }, value));
}

function downloadResults() {
  if (!state.results) return;
  const blob = new Blob([JSON.stringify(state.results, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "ta-results.json" });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- wiring ----------
$("btn-lookup").addEventListener("click", lookupCompany);
$("company-query").addEventListener("keydown", (e) => { if (e.key === "Enter") lookupCompany(); });
$("btn-fetch").addEventListener("click", fetchFromDart);
$("btn-json-load").addEventListener("click", () => loadJsonText($("json-input").value));
$("btn-sample").addEventListener("click", async () => {
  try {
    const sample = await api("/api/sample");
    delete sample._comment;
    $("json-input").value = JSON.stringify(sample, null, 2);
    $("input-unit").value = "1000000"; // the bundled sample is in KRW millions
    loadJsonText($("json-input").value);
  } catch (err) {
    setStatus(err.message, "error");
  }
});
$("btn-analyze").addEventListener("click", runAnalysis);
$("display-unit").addEventListener("change", renderResults);
$("input-unit").addEventListener("change", renderResults);
$("btn-download").addEventListener("click", downloadResults);

api("/api/config")
  .then((cfg) => {
    $("key-hint").textContent = cfg.hasServerApiKey ? "(서버에 키가 설정되어 있어 비워도 됩니다)" : "(필수)";
  })
  .catch(() => {});
