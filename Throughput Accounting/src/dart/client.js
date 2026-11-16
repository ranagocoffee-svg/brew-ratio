"use strict";

const BASE_URL = "https://opendart.fss.or.kr/api";

const STATUS_MESSAGES = {
  "000": "정상",
  "010": "등록되지 않은 키입니다.",
  "011": "사용할 수 없는 키입니다.(일시적으로 사용 중지된 키)",
  "012": "접근할 수 없는 IP입니다.",
  "013": "조회된 데이타가 없습니다.",
  "014": "파일이 존재하지 않습니다.",
  "020": "요청 제한을 초과하였습니다.",
  "100": "필드의 부적절한 값입니다.",
  "101": "부적절한 접근입니다.",
  "800": "시스템 점검 중입니다.",
  "900": "정의되지 않은 오류가 발생하였습니다.",
  "901": "사용자 계정의 개인정보 보유기간이 만료되어 사용할 수 없는 키입니다.",
};

class DartApiError extends Error {
  constructor(status, message, endpoint) {
    super(`DART API error ${status} (${endpoint}): ${message || STATUS_MESSAGES[status] || "알 수 없는 오류"}`);
    this.status = status;
    this.endpoint = endpoint;
  }
}

function requireApiKey(apiKey) {
  if (!apiKey) {
    throw new Error(
      "DART API key missing. Set the DART_API_KEY environment variable, or pass --api-key, " +
        "with a key issued at https://opendart.fss.or.kr (free registration; Claude cannot register one for you)."
    );
  }
  return apiKey;
}

async function fetchJsonRaw(endpoint, params) {
  const url = new URL(`${BASE_URL}/${endpoint}.json`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${endpoint} from DART`);
  }
  const data = await res.json();
  if (data.status && data.status !== "000") {
    throw new DartApiError(data.status, data.message, endpoint);
  }
  return data;
}

async function fetchJson(endpoint, params) {
  const data = await fetchJsonRaw(endpoint, params);
  return data.list || [];
}

async function fetchCorpCodeZip(apiKey) {
  requireApiKey(apiKey);
  const url = new URL(`${BASE_URL}/corpCode.xml`);
  url.searchParams.set("crtfc_key", apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching corpCode.xml from DART`);
  }
  const contentType = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());

  if (contentType.includes("xml") || contentType.includes("json")) {
    // DART returns a plain (non-zipped) XML/JSON error body on failure
    // (e.g. bad key) instead of the ZIP file.
    const text = buf.toString("utf8");
    const statusMatch = text.match(/<status>(\d+)<\/status>/) || text.match(/"status"\s*:\s*"(\d+)"/);
    const messageMatch = text.match(/<message>(.*?)<\/message>/) || text.match(/"message"\s*:\s*"(.*?)"/);
    throw new DartApiError(
      statusMatch ? statusMatch[1] : "???",
      messageMatch ? messageMatch[1] : text.slice(0, 200),
      "corpCode"
    );
  }
  return buf;
}

/**
 * 단일회사 전체 재무제표 (fnlttSinglAcntAll).
 * reprtCode: 11013=1Q, 11012=half-year, 11014=3Q, 11011=annual
 * fsDiv: "OFS" (separate) | "CFS" (consolidated)
 */
async function fetchFinancialStatements({ apiKey, corpCode, year, reprtCode, fsDiv }) {
  requireApiKey(apiKey);
  return fetchJson("fnlttSinglAcntAll", {
    crtfc_key: apiKey,
    corp_code: corpCode,
    bsns_year: year,
    reprt_code: reprtCode,
    fs_div: fsDiv,
  });
}

/** 직원현황 (empSttus). */
async function fetchEmployeeStatus({ apiKey, corpCode, year, reprtCode }) {
  requireApiKey(apiKey);
  return fetchJson("empSttus", {
    crtfc_key: apiKey,
    corp_code: corpCode,
    bsns_year: year,
    reprt_code: reprtCode,
  });
}

/** 기업개황 (company). Returns a single object, not a list. */
async function fetchCompanyProfile({ apiKey, corpCode }) {
  requireApiKey(apiKey);
  return fetchJsonRaw("company", { crtfc_key: apiKey, corp_code: corpCode });
}

module.exports = {
  DartApiError,
  requireApiKey,
  fetchCorpCodeZip,
  fetchFinancialStatements,
  fetchEmployeeStatus,
  fetchCompanyProfile,
};
