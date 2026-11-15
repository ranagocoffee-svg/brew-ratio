import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ganji, ganjiOfIso, isValidGanji, addDays } from "../tools/lunar.mjs";
import { parseSheet, mergeEntries } from "../tools/import_diary.mjs";
import { validateDir } from "../tools/validate.mjs";

const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "sample", "1597");
const OPT = { year: 1597, by: "tester", editionId: "ed-gyogam-noseungseok", readingId: "rd-noseungseok", today: "2026-01-01" };
const HEAD = "lunar_month\tlunar_day\tleap\tgregorian\tday_ganji\ttext_han\ttext_ko\tsource_ref\tnote";
// 본문은 테스트용 가짜 문자열이다 (실제 일기 내용 아님).
const row = (m, d, g = "", gj = "") => [m, d, "", g, gj, "TEST-HAN", "", "p.1", ""].join("\t");

test("일간지 기준점", () => {
  assert.equal(ganji(2000, 1, 1), "戊午");
  assert.equal(ganji(1900, 1, 1), "甲戌");
});

test("일간지는 하루씩 순환하며 60일 주기", () => {
  assert.equal(ganjiOfIso("1597-10-25"), "癸卯");
  assert.equal(ganjiOfIso("1597-10-26"), "甲辰");
  assert.equal(ganjiOfIso(addDays("1597-10-26", 60)), "甲辰");
});

test("육십갑자 유효성", () => {
  assert.ok(isValidGanji("甲子"));
  assert.ok(isValidGanji("癸亥"));
  assert.ok(!isValidGanji("甲丑")); // 홀짝 불일치
  assert.ok(!isValidGanji("A子"));
  assert.ok(!isValidGanji(null));
});

test("임포터: 일간지 甲辰 -> 명량 9/16 = 10/26 확정 (변환기와 +1일 차이 기록)", () => {
  const { entries, errors } = parseSheet(`${HEAD}\n${row(9, 16, "", "甲辰")}`, OPT);
  assert.deepEqual(errors, []);
  const d = entries[0].date;
  assert.equal(d.gregorian, "1597-10-26");
  assert.equal(d.computed_gregorian, "1597-10-25");
  assert.equal(d.certainty, "verified");
  assert.ok(d.note.includes("1일 차이"));
});

test("임포터: 일간지 癸卯 -> 10/25 확정", () => {
  const { entries } = parseSheet(`${HEAD}\n${row(9, 16, "", "癸卯")}`, OPT);
  assert.equal(entries[0].date.gregorian, "1597-10-25");
  assert.equal(entries[0].date.certainty, "verified");
});

test("임포터: 입력 양력과 일간지가 어긋나면 거부", () => {
  const { errors } = parseSheet(`${HEAD}\n${row(9, 16, "1597-10-26", "癸卯")}`, OPT);
  assert.ok(errors[0].includes("일간지"));
});

test("임포터: 변환값 ±3일 안에 없는 일간지, 존재하지 않는 일간지 거부", () => {
  assert.ok(parseSheet(`${HEAD}\n${row(9, 16, "", "甲子")}`, OPT).errors[0].includes("±3일"));
  assert.ok(parseSheet(`${HEAD}\n${row(9, 16, "", "甲丑")}`, OPT).errors[0].includes("존재하지 않는 일간지"));
});

function validateWith(entries) {
  const tmp = mkdtempSync(join(tmpdir(), "yi-"));
  try {
    cpSync(SAMPLE, tmp, { recursive: true });
    const existing = JSON.parse(readFileSync(join(tmp, "diary_entries.json"), "utf-8"));
    writeFileSync(join(tmp, "diary_entries.json"), JSON.stringify(mergeEntries(existing, entries)));
    return validateDir(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("검증기: 일간지로 확정된 항목은 변환기와 달라도 통과", () => {
  const { entries } = parseSheet(`${HEAD}\n${row(9, 16, "", "甲辰")}`, OPT);
  assert.deepEqual(validateWith(entries), []);
});

test("검증기: 일간지와 gregorian 이 어긋나면 오류", () => {
  const { entries } = parseSheet(`${HEAD}\n${row(9, 16, "", "甲辰")}`, OPT);
  entries[0].day_ganji = "癸卯"; // 데이터 손상 시나리오
  assert.ok(validateWith(entries).some((e) => e.includes("일간지 불일치")));
});

test("검증기: 일간지 없이 변환기와 다른 양력은 여전히 disputed 필요", () => {
  const { entries } = parseSheet(`${HEAD}\n${row(9, 16, "1597-10-26")}`, OPT);
  assert.equal(entries[0].date.certainty, "disputed");
  assert.deepEqual(validateWith(entries), []);
  entries[0].date.certainty = "unverified";
  assert.ok(validateWith(entries).some((e) => e.includes("disputed")));
});
