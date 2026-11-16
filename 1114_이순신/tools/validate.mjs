// 샘플 데이터 검증기 (Node 18+, 의존성 없음).
// 검사: 스키마(type/required/enum/pattern/items/$ref), id 유일성, 참조 무결성,
// 그레고리력-율리우스력 일치, 기준 판본 1개, verified 와 certainty 일관성.
// 사용법: node tools/validate.mjs [data/sample/nanjung]
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gregorianToJulian, lunarToGregorian, ganjiOfIso, isValidGanji, addDays } from "./lunar.mjs";

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
  "reading_issues.json": "ReadingIssue",
  "records.json": "Record",
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
  // 원본 달력 표기와 저장된 날짜 필드의 일치(오타 방지): 그레고리/율리우스 원본은 해당 필드가 원본 표기와 같아야 한다.
  {
    const p2 = (n) => String(n).padStart(2, "0");
    const ymd = o?.year ? `${o.year}-${p2(o.month ?? 0)}-${p2(o.day ?? 0)}` : null;
    if (o?.calendar === "gregorian" && rec.precision === "day" && g && g !== ymd) errors.push(`${path}: 원본(그레고리력) ${ymd} 와 gregorian ${g} 가 다름`);
    if (o?.calendar === "gregorian" && rec.precision === "month" && g && g !== `${o.year}-${p2(o.month)}`) errors.push(`${path}: 원본 연월과 gregorian ${g} 가 다름`);
    if (o?.calendar === "gregorian" && rec.precision === "year" && g && g !== String(o.year)) errors.push(`${path}: 원본 연도와 gregorian ${g} 가 다름`);
    if (o?.calendar === "julian" && rec.precision === "day") {
      if (rec.julian !== ymd) errors.push(`${path}: 원본(율리우스력) ${ymd} 와 julian ${rec.julian} 가 다름`);
      if (!g) errors.push(`${path}: 율리우스력 원본 날짜에는 환산한 gregorian 이 필요함`);
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
    // 외부 기록(실록)으로 확정한 날짜: 기록 헤더 일간지가 확정돼 있고, 인용된 음력 날짜에서 도출한 양력이 사건 날짜와 같아야 한다.
    let recBasisOk = false;
    for (const [bi, br] of (ev.date?.basis_records ?? []).entries()) {
      const w = `${ev.id}.basis_records[${bi}]`;
      const rc = data["records.json"].find((x) => x.id === br.record_id);
      if (!rc) { errors.push(`${w}: 기록 ${JSON.stringify(br.record_id)} 가 없음`); continue; }
      const st = (rc.statements ?? [])[br.statement];
      if (!st?.stated_lunar) { errors.push(`${w}: ${rc.id} statements[${br.statement}] 가 없거나 stated_lunar 가 없음`); continue; }
      if (rc.date.certainty !== "verified" || !rc.day_ganji) { errors.push(`${w}: ${rc.id} 의 날짜가 일간지로 확정되지 않음`); continue; }
      const ro = rc.date.original, { month, day } = st.stated_lunar;
      let derived = null;
      if (br.bridge_entry_id) {
        const de = data["diary_entries.json"].find((x) => x.id === br.bridge_entry_id);
        if (!de || de.date.certainty !== "verified" || !de.day_ganji) errors.push(`${w}: 연결 일기 항목 ${br.bridge_entry_id} 가 없거나 일간지로 확정되지 않음`);
        else if (de.date.original.year !== ro.year || de.date.original.month !== month || de.date.original.day !== day) errors.push(`${w}: 연결 일기 항목의 음력 날짜가 인용된 날짜(${month}/${day})와 다름`);
        else derived = de.date.gregorian;
      } else if (month !== ro.month || ro.leap_month) {
        errors.push(`${w}: 인용 날짜의 달(${month})이 기록의 달(${ro.month})과 다르면 bridge_entry_id(일간지로 확정된 일기 항목)가 필요함`);
      } else {
        derived = addDays(rc.date.gregorian, day - ro.day); // 같은 달: 기록 날짜(일간지로 확정)에서 일수 차이만큼 이동
      }
      if (derived && derived !== ev.date.gregorian) errors.push(`${w}: 근거에서 도출한 양력 ${derived} 가 사건의 gregorian ${ev.date.gregorian} 과 다름`);
      else if (derived) recBasisOk = true;
    }
    // 세계 트랙: 날짜를 verified 로 올리려면 일기 또는 외부 기록(실록)의 근거가 필요하다.
    if (ev.track === "world" && ev.date?.certainty === "verified" && !basisOk && !recBasisOk) errors.push(`${ev.id}: 세계 사건의 verified 날짜에는 basis_entry_ids 또는 basis_records 근거가 필요함`);
    if (ev.track === "world" && ev.verified && !basisOk && !recBasisOk) errors.push(`${ev.id}: verified=true 인 세계 사건에는 일기·외부 기록 근거가 필요함`);
    if (ev.date) checkDate(ev.date, ev.id, errors, null, basisOk);
    // 세계 트랙: 지역 필수, 출처 필수, 관련 항목(relates_to)은 실제로 있어야 한다.
    if (ev.track === "world" && !ev.region) errors.push(`${ev.id}: 세계 트랙 사건에는 region 이 필요함`);
    if (ev.track === "yi" && ev.region) errors.push(`${ev.id}: 이순신 트랙 사건에는 region 을 쓰지 않음`);
    if (!(ev.source_ids ?? []).length) errors.push(`${ev.id}: source_ids 가 비어 있음`);
    for (const rid of ev.relates_to ?? []) {
      if (!data["events.json"].some((x) => x.id === rid) && !data["diary_entries.json"].some((x) => x.id === rid) && !data["records.json"].some((x) => x.id === rid)) errors.push(`${ev.id}: relates_to 대상 ${JSON.stringify(rid)} 가 존재하지 않음`);
    }
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
  // 외부 기록(실록): 헤더 날짜는 일간지로 확정(checkDate), 출처 존재, 인용은 짧게(저작권·국역 비수록 원칙).
  for (const rc of data["records.json"]) {
    ref("sources.json", rc.source_id, rc.id);
    if (rc.date) checkDate(rc.date, rc.id, errors, rc.day_ganji ?? null);
    for (const [i, st] of (rc.statements ?? []).entries()) {
      if (st.text_han && st.text_han.length > 125) errors.push(`${rc.id}.statements[${i}]: 원문 인용은 125자 이하여야 함(${st.text_han.length}자)`);
      if (!st.text_han && st.part !== "표제") errors.push(`${rc.id}.statements[${i}]: 본문 인용에는 text_han 이 필요함`);
    }
  }
  // 판독 쟁점 카드: 출현 위치는 실제 일기 본문에 있어야 하고, 주장(claim)에는 출처가 반드시 붙어야 한다.
  for (const ri of data["reading_issues.json"]) {
    const occIds = new Set();
    for (const [i, oc] of (ri.occurrences ?? []).entries()) {
      const w = `${ri.id}.occurrences[${i}]`;
      const de = data["diary_entries.json"].find((x) => x.id === oc.entry_id);
      if (!de) { errors.push(`${w}: 존재하지 않는 일기 항목 ${JSON.stringify(oc.entry_id)}`); continue; }
      occIds.add(oc.entry_id);
      if (!de.text_han?.includes(oc.portal_reading)) errors.push(`${w}: portal_reading ${JSON.stringify(oc.portal_reading)} 가 ${oc.entry_id} 본문에 없음`);
      if (!de.text_han?.includes(oc.context)) errors.push(`${w}: context ${JSON.stringify(oc.context)} 가 ${oc.entry_id} 본문에 없음`);
      if (oc.context && !oc.context.includes(oc.portal_reading)) errors.push(`${w}: context 에 portal_reading 이 포함되어야 함`);
    }
    for (const r of ri.readings ?? []) {
      (r.source_ids ?? []).forEach((s) => ref("sources.json", s, `${ri.id}.${r.id}`));
      if (r.status === "claim" && !(r.source_ids ?? []).length) errors.push(`${ri.id}.${r.id}: 주장(claim)에는 source_ids 가 필요함`);
      for (const k of Object.keys(r.per_entry ?? {})) if (!occIds.has(k)) errors.push(`${ri.id}.${r.id}: per_entry 키 ${k} 가 occurrences 에 없음`);
    }
    for (const it of ri.interpretations ?? []) {
      (it.source_ids ?? []).forEach((s) => ref("sources.json", s, `${ri.id}.${it.id}`));
      if (!(it.source_ids ?? []).length) errors.push(`${ri.id}.${it.id}: 해석에는 source_ids 가 필요함`);
    }
    for (const h of ri.history ?? []) {
      (h.source_ids ?? []).forEach((s) => ref("sources.json", s, `${ri.id}.history`));
      if (h.status === "claim" && !(h.source_ids ?? []).length) errors.push(`${ri.id}.history ${h.year}: 주장(claim)에는 source_ids 가 필요함`);
    }
    // 판독 쟁점이 하나의 읽기만 남으면 쟁점이 아니다. unresolved 인데 observed 하나뿐이면 오류.
    if (ri.status === "unresolved" && (ri.readings ?? []).filter((r) => r.status === "claim").length < 1) errors.push(`${ri.id}: unresolved 쟁점에는 비교할 주장(claim)이 하나 이상 있어야 함`);
  }
  for (const ed of data["editions.json"]) (ed.derived_from ?? []).forEach((p) => ref("editions.json", p, ed.id));
  if (data["editions.json"].filter((e) => e.is_base).length !== 1) errors.push("editions.json: is_base=true 는 정확히 1개여야 함");
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = resolve(process.argv[2] ?? join(ROOT, "data", "sample", "nanjung"));
  const errors = validateDir(target);
  if (errors.length) {
    console.log(`검증 실패 (${errors.length}건)`);
    errors.forEach((e) => console.log(" -", e));
    process.exit(1);
  }
  console.log(`검증 통과: ${target}`);
}
