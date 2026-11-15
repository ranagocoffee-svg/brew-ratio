// 샘플 데이터 검증기 (Node 18+, 의존성 없음).
// 검사: 스키마(type/required/enum/pattern/items/$ref), id 유일성, 참조 무결성,
// 그레고리력-율리우스력 일치, 기준 판본 1개, verified 와 certainty 일관성.
// 사용법: node tools/validate.mjs [data/sample/1597]
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gregorianToJulian, lunarToGregorian, ganjiOfIso, isValidGanji } from "./lunar.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = JSON.parse(readFileSync(join(ROOT, "data", "schema", "schema.json"), "utf-8"));

export const FILES = {
  "sources.json": "Source",
  "editions.json": "Edition",
  "readings.json": "Reading",
  "events.json": "Event",
  "claims.json": "Claim",
  "diary_entries.json": "DiaryEntry",
  "coverage.json": "Coverage",
};

const typeOk = (v, t) =>
  (Array.isArray(t) ? t : [t]).some((n) => {
    switch (n) {
      case "string": return typeof v === "string";
      case "integer": return Number.isInteger(v);
      case "number": return typeof v === "number";
      case "boolean": return typeof v === "boolean";
      case "array": return Array.isArray(v);
      case "object": return v !== null && typeof v === "object" && !Array.isArray(v);
      case "null": return v === null;
      default: return false;
    }
  });

function check(value, schema, path, errors) {
  if (schema.$ref) schema = SCHEMA.$defs[schema.$ref.split("/").pop()];
  if (schema.type && !typeOk(value, schema.type)) {
    errors.push(`${path}: 타입 불일치 (${JSON.stringify(schema.type)}) -> ${JSON.stringify(value)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: 허용되지 않은 값 ${JSON.stringify(value)}`);
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value))
    errors.push(`${path}: 패턴 불일치 ${JSON.stringify(value)}`);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}: 필수 필드 누락 '${k}'`);
    for (const [k, sub] of Object.entries(schema.properties ?? {})) if (k in value) check(value[k], sub, `${path}.${k}`, errors);
  }
  if (Array.isArray(value) && schema.items) value.forEach((it, i) => check(it, schema.items, `${path}[${i}]`, errors));
}

export { gregorianToJulian };

function checkDate(rec, path, errors, dayGanji = null, basisOk = false) {
  const { gregorian: g, julian: j } = rec;
  if (g && j && g.length === 10 && j.length === 10) {
    try {
      if (gregorianToJulian(g) !== j) errors.push(`${path}: 그레고리력 ${g} 와 율리우스력 ${j} 불일치`);
    } catch (e) {
      errors.push(`${path}: ${e.message}`);
    }
  }
  // 일간지: 일기가 직접 적은 날짜 식별자. 양력과 일치하면 변환기와 달라도 분쟁이 해소된 것으로 본다.
  let ganjiOk = false;
  if (dayGanji) {
    if (!isValidGanji(dayGanji)) errors.push(`${path}: 존재하지 않는 일간지 '${dayGanji}' (천간·지지 홀짝 불일치 포함)`);
    else if (g && g.length === 10) {
      const actual = ganjiOfIso(g);
      const gc = rec.ganji_check;
      if (actual === dayGanji) ganjiOk = true;
      else if (gc && gc.written === dayGanji && gc.expected === actual && rec.certainty === "disputed") {
        // 일기에 적힌 간지가 실제와 다름을 명시적으로 기록한 경우(ganji_check): 허용하되 확정(ganjiOk)으로 보지 않는다.
        if (gc.stem_match !== (dayGanji[0] === actual[0])) errors.push(`${path}: ganji_check.stem_match 가 실제 비교 결과와 다름`);
      } else errors.push(`${path}: 일간지 불일치 — 일기 ${dayGanji}, gregorian ${g} 의 일간지는 ${actual} (의도된 불일치라면 certainty=disputed 와 ganji_check 기록 필요)`);
    }
  }
  // 음력 원본 + 일 단위 날짜는 변환기로 재계산해 대조한다. 어긋나면 disputed 로 명시해야 한다(일간지로 확정된 경우 제외).
  const o = rec.original;
  if (o?.calendar === "lunisolar" && rec.precision === "day" && o.month != null && o.day != null) {
    const calc = lunarToGregorian(o.year, o.month, o.day, o.leap_month);
    if (!calc) {
      // 변환기 표에 없는 날짜(예: 변환기가 29일로 보는 달의 30일). 일간지로 확정됐거나 disputed 면 허용.
      if (rec.certainty !== "disputed" && !ganjiOk && !basisOk) errors.push(`${path}: 변환기 표에 없는 음력 날짜 (일간지로 확정하거나 certainty=disputed 로 명시 필요)`);
    } else {
      if (rec.computed_gregorian && rec.computed_gregorian !== calc.gregorian)
        errors.push(`${path}: 저장된 computed_gregorian ${rec.computed_gregorian} 가 재계산값 ${calc.gregorian} 과 다름`);
      if (g && g.length === 10 && g !== calc.gregorian && rec.certainty !== "disputed" && !ganjiOk && !basisOk)
        errors.push(`${path}: gregorian ${g} 가 변환값 ${calc.gregorian} 과 다름 (certainty=disputed 로 명시하고 computed_gregorian 기록 필요)`);
      if (g && g.length === 10 && g !== calc.gregorian && !rec.computed_gregorian)
        errors.push(`${path}: 불일치인데 computed_gregorian 미기록`);
    }
  }
  if (rec.precision === "range" && (rec.end_year ?? null) === null) errors.push(`${path}: precision=range 인데 end_year 없음`);
  if (rec.precision === "day" && (rec.original?.month == null || rec.original?.day == null))
    errors.push(`${path}: precision=day 인데 원본 월/일 누락`);
}

export function validateDir(dir) {
  const errors = [];
  const data = {};
  for (const [fname, def] of Object.entries(FILES)) {
    const f = join(dir, fname);
    if (!existsSync(f)) { errors.push(`${fname}: 파일 없음`); data[fname] = []; continue; }
    data[fname] = JSON.parse(readFileSync(f, "utf-8"));
    data[fname].forEach((item, i) => check(item, { $ref: `#/$defs/${def}` }, `${fname}[${i}]`, errors));
  }

  const seen = new Map();
  for (const [fname, items] of Object.entries(data))
    for (const it of items) {
      if (seen.has(it.id)) errors.push(`id 중복: ${it.id} (${seen.get(it.id)}, ${fname})`);
      seen.set(it.id, fname);
    }

  const ref = (file, value, where) => {
    if (!data[file].some((x) => x.id === value)) errors.push(`${where}: 존재하지 않는 참조 ${JSON.stringify(value)}`);
  };

  for (const ev of data["events.json"]) {
    (ev.source_ids ?? []).forEach((s) => ref("sources.json", s, ev.id));
    // 일기 일간지로 확정한 사건 날짜: basis_entry_ids 의 항목이 같은 양력·확정 상태·일간지를 가져야 인정.
    let basisOk = false;
    const basis = ev.date?.basis_entry_ids ?? [];
    if (basis.length) {
      const bad = basis.filter((id) => {
        const de = data["diary_entries.json"].find((x) => x.id === id);
        return !(de && de.day_ganji && de.date.certainty === "verified" && de.date.gregorian === ev.date.gregorian);
      });
      if (bad.length) errors.push(`${ev.id}: basis_entry_ids ${bad.join(", ")} 가 존재하지 않거나 같은 양력으로 확정(verified, 일간지 있음)되지 않음`);
      else basisOk = true;
    }
    if (ev.date) checkDate(ev.date, ev.id, errors, null, basisOk);
    if (ev.verified && ev.date?.certainty !== "verified") errors.push(`${ev.id}: verified=true 인데 date.certainty 가 verified 아님`);
  }
  for (const cl of data["claims.json"]) {
    ref("events.json", cl.event_id, cl.id);
    (cl.source_ids ?? []).forEach((s) => ref("sources.json", s, cl.id));
  }
  for (const rd of data["readings.json"]) ref("editions.json", rd.edition_id, rd.id);
  for (const de of data["diary_entries.json"]) {
    ref("editions.json", de.edition_id, de.id);
    ref("readings.json", de.reading_id, de.id);
    if (de.date) checkDate(de.date, de.id, errors, de.day_ganji ?? null);
    const rd = data["readings.json"].find((r) => r.id === de.reading_id);
    if (rd && rd.edition_id !== de.edition_id) errors.push(`${de.id}: reading 의 판본과 entry 의 판본이 다름`);
    if (de.text_status !== "placeholder" && !de.text_han) errors.push(`${de.id}: placeholder 가 아닌데 text_han 없음`);
    if (de.text_status !== "placeholder" && !de.source_ref) errors.push(`${de.id}: 본문이 있는데 source_ref(저본 위치) 없음`);
    if (de.text_status !== "placeholder" && !de.input_by) errors.push(`${de.id}: 본문이 있는데 input_by 없음`);
    if (de.text_status === "reviewed" && !de.reviewed_by) errors.push(`${de.id}: reviewed 인데 reviewed_by 없음`);
    if (de.text_ko && !de.translator) errors.push(`${de.id}: text_ko 가 있는데 translator 없음`);
  }
  const dayKeys = new Map();
  for (const de of data["diary_entries.json"]) {
    const o = de.date.original;
    const k = `${de.edition_id}|${de.reading_id}|${de.volume ?? ""}|${o.year}-${o.leap_month ? "L" : ""}${o.month}-${o.day}`;
    if (dayKeys.has(k)) errors.push(`${de.id}: 같은 판본·판독·책·날짜 중복 (${dayKeys.get(k)})`);
    dayKeys.set(k, de.id);
    if (o.month < 1 || o.month > 12 || o.day < 1 || o.day > 30) errors.push(`${de.id}: 음력 월/일 범위 오류`);
  }
  for (const cv of data["coverage.json"]) {
    ref("editions.json", cv.edition_id, cv.id);
    (cv.source_ids ?? []).forEach((s) => ref("sources.json", s, cv.id));
  }
  for (const ed of data["editions.json"]) (ed.derived_from ?? []).forEach((p) => ref("editions.json", p, ed.id));
  if (data["editions.json"].filter((e) => e.is_base).length !== 1) errors.push("editions.json: is_base=true 는 정확히 1개여야 함");
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = resolve(process.argv[2] ?? join(ROOT, "data", "sample", "1597"));
  const errors = validateDir(target);
  if (errors.length) {
    console.log(`검증 실패 (${errors.length}건)`);
    errors.forEach((e) => console.log(" -", e));
    process.exit(1);
  }
  console.log(`검증 통과: ${target}`);
}
