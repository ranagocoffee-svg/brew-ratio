// TSV 입력 시트 -> diary_entries.json 병합.
// 사용법: node tools/import_diary.mjs <input.tsv> <data-dir> --year 1597 --by <입력자>
//         [--edition ed-gyogam-noseungseok] [--reading rd-noseungseok] [--dry]
// 같은 id 의 기존 항목은 교체하고, 나머지(placeholder 포함)는 유지한다.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gregorianToJulian, lunarToGregorian, ganjiOfIso, isValidGanji, addDays, CONVERTER } from "./lunar.mjs";

const REQUIRED = ["lunar_month", "lunar_day", "text_han", "source_ref"];
const pad = (n) => String(n).padStart(2, "0");
const unescapeCell = (s) => s.replace(/\\(n|\\)/g, (_, c) => (c === "n" ? "\n" : "\\"));
const orNull = (s) => (s === undefined || s.trim() === "" ? null : s);

export function entryId(editionId, year, month, day, leap) {
  const short = editionId.replace(/^ed-/, "").split("-")[0];
  return `de-${short}-${year}-${leap ? "L" : ""}${pad(month)}-${pad(day)}`;
}

/** TSV 텍스트 -> { entries, errors }. 오류가 있으면 쓰지 않는다. */
export function parseSheet(text, { year, by, editionId, readingId, today, translator }) {
  const errors = [];
  const entries = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "" && !l.startsWith("#"));
  if (!lines.length) return { entries, errors: ["헤더 줄이 없음"] };
  const header = lines[0].split("\t").map((h) => h.trim());
  for (const r of REQUIRED) if (!header.includes(r)) errors.push(`헤더에 '${r}' 열이 없음`);
  if (errors.length) return { entries, errors };

  const seen = new Set();
  lines.slice(1).forEach((line, i) => {
    const where = `입력 ${i + 1}행`;
    const cells = line.split("\t");
    const row = Object.fromEntries(header.map((h, k) => [h, cells[k] ?? ""]));
    const month = Number(row.lunar_month);
    const day = Number(row.lunar_day);
    const leap = ["1", "true", "윤", "y"].includes((row.leap ?? "").trim().toLowerCase());
    if (!Number.isInteger(month) || month < 1 || month > 12) return errors.push(`${where}: lunar_month 범위 오류 '${row.lunar_month}'`);
    if (!Number.isInteger(day) || day < 1 || day > 30) return errors.push(`${where}: lunar_day 범위 오류 '${row.lunar_day}'`);
    if (!row.text_han.trim()) return errors.push(`${where}: text_han 비어 있음`);
    if (!row.source_ref.trim()) return errors.push(`${where}: source_ref 비어 있음`);
    let g = orNull(row.gregorian)?.trim() ?? null;
    let julian = null;
    if (g) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(g)) return errors.push(`${where}: gregorian 형식 오류 '${g}'`);
      try { julian = gregorianToJulian(g); } catch (e) { return errors.push(`${where}: ${e.message}`); }
    }
    // 변환기 계산값과 대조. 입력값이 없으면 계산값을 채우되 unverified, 어긋나면 disputed 로 병기한다.
    const calc = lunarToGregorian(year, month, day, leap);
    let certainty = "unverified";
    let dateNote;
    const dayGanji = orNull(row.day_ganji)?.trim() ?? null;
    if (dayGanji && !isValidGanji(dayGanji)) return errors.push(`${where}: 존재하지 않는 일간지 '${dayGanji}'`);
    if (dayGanji) {
      // 일간지는 날짜를 직접 식별한다. 입력 양력이 있으면 대조, 없으면 변환값 ±3일 안에서 찾는다.
      if (g) {
        if (ganjiOfIso(g) !== dayGanji) return errors.push(`${where}: 입력 양력 ${g} 의 일간지는 ${ganjiOfIso(g)} 인데 일기는 ${dayGanji}`);
      } else {
        const base = calc?.gregorian;
        const found = base && [0, -1, 1, -2, 2, -3, 3].map((n) => addDays(base, n)).find((c) => ganjiOfIso(c) === dayGanji);
        if (!found) return errors.push(`${where}: 일간지 ${dayGanji} 에 해당하는 날이 변환값${base ? ` ${base}` : ""} ±3일 안에 없음 (입력 오류 가능)`);
        g = found;
        try { julian = gregorianToJulian(g); } catch (e) { return errors.push(`${where}: ${e.message}`); }
      }
      certainty = "verified";
      dateNote = calc && calc.gregorian !== g
        ? `일간지 ${dayGanji} 로 확정. 변환기(${calc.gregorian})와 ${Math.round((new Date(g) - new Date(calc.gregorian)) / 86400000)}일 차이 — 변환기 표 오류 가능성.`
        : `일간지 ${dayGanji} 로 확정(변환기와 일치).`;
    } else if (!g) {
      if (calc) { g = calc.gregorian; julian = calc.julian; dateNote = "양력은 변환기 계산값(사료 대조 전)."; }
      else { certainty = "disputed"; dateNote = "변환기 표에 없는 음력 날짜. 양력 미확정."; }
    } else if (!calc) {
      certainty = "disputed"; dateNote = "변환기 표에 없는 음력 날짜. 양력은 입력자 제공값.";
    } else if (calc.gregorian !== g) {
      certainty = "disputed"; dateNote = `입력 양력 ${g} 와 변환기 ${calc.gregorian} 불일치. 어느 쪽도 확정하지 않음.`;
    } else {
      dateNote = "입력 양력과 변환기 계산값 일치(사료 대조 전).";
    }
    const id = entryId(editionId, year, month, day, leap);
    if (seen.has(id)) return errors.push(`${where}: 같은 날짜 중복 (${id})`);
    seen.add(id);
    entries.push({
      id, edition_id: editionId, reading_id: readingId,
      date: {
        original: { calendar: "lunisolar", year, month, day, leap_month: leap },
        gregorian: g, julian,
        computed_gregorian: calc?.gregorian ?? null, converter: calc ? CONVERTER : null,
        precision: "day", certainty, note: dateNote,
      },
      day_ganji: dayGanji,
      text_han: unescapeCell(row.text_han.normalize("NFC")),
      text_ko: orNull(row.text_ko) === null ? null : unescapeCell(row.text_ko.normalize("NFC")),
      translator: orNull(row.text_ko) === null ? null : (translator ?? null),
      source_ref: row.source_ref.trim(),
      input_by: by, input_date: today, reviewed_by: null,
      text_status: "transcribed",
      note: orNull(row.note),
    });
  });
  return { entries, errors };
}

export function mergeEntries(existing, incoming) {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  const key = (e) => {
    const o = e.date.original;
    return o.year * 10000 + o.month * 100 + o.day + (o.leap_month ? 50 : 0);
  };
  return [...byId.values()].sort((a, b) => key(a) - key(b));
}

/** 월별 입력 일수 요약. '없음'이 아니라 '입력되지 않음'으로 읽어야 함. */
export function summarize(entries) {
  const m = new Map();
  for (const e of entries) {
    if (e.text_status === "placeholder") continue;
    const o = e.date.original;
    const k = `${o.year}-${o.leap_month ? "윤" : ""}${pad(o.month)}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort().map(([k, n]) => `${k}월: ${n}일 입력`);
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const [input, dir] = args;
  const year = Number(opt("--year"));
  const by = opt("--by");
  if (!input || !dir || !year || !by) {
    console.error("사용법: node tools/import_diary.mjs <input.tsv> <data-dir> --year 1597 --by <입력자> [--dry]");
    process.exit(2);
  }
  const { entries, errors } = parseSheet(readFileSync(resolve(input), "utf-8"), {
    year, by,
    editionId: opt("--edition", "ed-gyogam-noseungseok"),
    readingId: opt("--reading", "rd-noseungseok"),
    translator: opt("--translator", null),
    today: new Date().toISOString().slice(0, 10),
  });
  if (errors.length) {
    console.log(`입력 오류 ${errors.length}건 (파일은 수정하지 않음)`);
    errors.forEach((e) => console.log(" -", e));
    process.exit(1);
  }
  const target = join(resolve(dir), "diary_entries.json");
  const merged = mergeEntries(JSON.parse(readFileSync(target, "utf-8")), entries);
  console.log(`입력 ${entries.length}건 -> 총 ${merged.length}건`);
  summarize(merged).forEach((s) => console.log(" ", s));
  if (!args.includes("--dry")) {
    writeFileSync(target, JSON.stringify(merged, null, 2) + "\n", "utf-8");
    console.log("저장:", target, "\n다음: npm run validate");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
