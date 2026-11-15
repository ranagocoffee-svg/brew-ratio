import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ganji, ganjiOfIso, isValidGanji, addDays, compareGanji } from "../tools/lunar.mjs";
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

test("임포터: 존재하지 않는 일간지는 거부", () => {
  assert.ok(parseSheet(`${HEAD}\n${row(9, 16, "", "甲丑")}`, OPT).errors[0].includes("존재하지 않는 일간지"));
});

test("임포터: 일기 간지가 변환값 ±3일과 안 맞으면 거부하지 않고 disputed + ganji_check 로 기록 (천간 우선)", () => {
  // 5책 정유일기 9/16 의 실제 표기: 甲午 (실제 10/26 은 甲辰). 천간(甲)이 10/26 과 맞는다.
  const { entries, errors } = parseSheet(`${HEAD}\n${row(9, 16, "", "甲午")}`, OPT);
  assert.deepEqual(errors, []);
  const d = entries[0].date;
  assert.equal(d.gregorian, "1597-10-26");
  assert.equal(d.computed_gregorian, "1597-10-25"); // 변환기와 하루 차이를 그대로 병기
  assert.equal(d.certainty, "disputed");
  assert.deepEqual(d.ganji_check, { written: "甲午", expected: "甲辰", stem_match: true, branch_shift: 2 });
  assert.equal(entries[0].day_ganji, "甲午"); // 기록된 간지를 고치지 않는다
});

test("임포터: 천간도 안 맞으면 변환값을 유지하고 stem_match=false", () => {
  const { entries } = parseSheet(`${HEAD}\n${row(9, 16, "", "乙卯")}`, OPT);
  assert.equal(entries[0].date.gregorian, "1597-10-25");
  assert.equal(entries[0].date.ganji_check.stem_match, false);
  assert.equal(entries[0].date.certainty, "disputed");
});

test("검증기: ganji_check 로 명시된 불일치는 통과, 명시가 틀리면 오류", () => {
  const { entries } = parseSheet(`${HEAD}\n${row(9, 16, "", "甲午")}`, OPT);
  assert.deepEqual(validateWith(entries), []);
  entries[0].date.ganji_check.expected = "甲子";
  assert.ok(validateWith(entries).some((e) => e.includes("일간지 불일치")));
});

test("compareGanji: 지지 이동량", () => {
  assert.deepEqual(compareGanji("癸未", "癸巳"), { written: "癸未", expected: "癸巳", stem_match: true, branch_shift: 2 });
  assert.equal(compareGanji("辛酉", "辛亥").branch_shift, -2);
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
