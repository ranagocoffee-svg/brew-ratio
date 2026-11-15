import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSheet, mergeEntries, entryId, summarize } from "../tools/import_diary.mjs";
import { validateDir } from "../tools/validate.mjs";

const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "sample", "1597-1598");
const OPT = { year: 1597, by: "tester", editionId: "ed-gyogam-noseungseok", readingId: "rd-noseungseok", today: "2026-01-01" };
const HEAD = "lunar_month\tlunar_day\tleap\tgregorian\ttext_han\ttext_ko\tsource_ref\tnote";
// 아래 본문은 모두 테스트용 가짜 문자열이다 (실제 일기 내용 아님).
const row = (m, d, extra = {}) =>
  [m, d, extra.leap ?? "", extra.g ?? "", extra.han ?? "TEST-HAN", extra.ko ?? "", extra.ref ?? "p.1", ""].join("\t");

test("id 규칙: 윤달은 L 접두", () => {
  assert.equal(entryId("ed-gyogam-noseungseok", 1597, 9, 16, false), "de-gyogam-1597-09-16");
  assert.equal(entryId("ed-gyogam-noseungseok", 1597, 5, 3, true), "de-gyogam-1597-L05-03");
});

test("정상 입력: 주석·빈 줄 무시, 이스케이프 해석", () => {
  const { entries, errors } = parseSheet(`# c\n${HEAD}\n\n${row(9, 16, { han: "A\\nB", g: "1597-10-26" })}\n`, OPT);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text_han, "A\nB");
  assert.equal(entries[0].date.julian, "1597-10-16"); // 입력값 기준 -10일
  assert.equal(entries[0].text_status, "transcribed");
  // 입력 양력(10-26)과 변환기(10-25)가 달라 disputed 로 병기된다
  assert.equal(entries[0].date.certainty, "disputed");
  assert.equal(entries[0].date.computed_gregorian, "1597-10-25");
});

test("양력 미입력 시 변환값을 채우되 unverified", () => {
  const { entries } = parseSheet(`${HEAD}\n${row(9, 16)}`, OPT);
  assert.equal(entries[0].date.gregorian, "1597-10-25");
  assert.equal(entries[0].date.julian, "1597-10-15");
  assert.equal(entries[0].date.certainty, "unverified");
});

test("입력 양력이 변환기와 일치하면 unverified 유지 (1592-04-13 -> 05-23)", () => {
  const { entries } = parseSheet(`${HEAD}\n${row(4, 13, { g: "1592-05-23" })}`, { ...OPT, year: 1592 });
  assert.equal(entries[0].date.certainty, "unverified");
  assert.equal(entries[0].date.computed_gregorian, "1592-05-23");
});

test("오류: 필수 열 누락 / 범위 / 중복 / 빈 본문 / source_ref 없음", () => {
  assert.ok(parseSheet("a\tb\n1\t2", OPT).errors[0].includes("lunar_month"));
  const bad = parseSheet(`${HEAD}\n${row(13, 1)}\n${row(1, 31)}\n${row(2, 2, { han: " " })}\n${row(3, 3, { ref: "" })}\n${row(4, 4)}\n${row(4, 4)}`, OPT);
  assert.equal(bad.errors.length, 5);
});

test("오류: 형식이 틀린 양력", () => {
  assert.ok(parseSheet(`${HEAD}\n${row(9, 16, { g: "1597/10/26" })}`, OPT).errors[0].includes("gregorian"));
});

test("병합: 같은 id 교체, 기존 placeholder 유지, 날짜순 정렬", () => {
  // 샘플 내용이 늘어도 영향받지 않도록 placeholder 항목 하나만 기존 데이터로 쓴다.
  const existing = JSON.parse(readFileSync(join(SAMPLE, "diary_entries.json"), "utf-8")).filter((e) => e.id === "de-gyogam-1597-09-16");
  assert.equal(existing.length, 1);
  assert.equal(existing[0].text_status, "placeholder");
  const { entries } = parseSheet(`${HEAD}\n${row(3, 1)}\n${row(9, 16)}`, OPT);
  const merged = mergeEntries(existing, entries);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].date.original.month, 3);
  assert.equal(merged[1].text_status, "transcribed");
  assert.deepEqual(summarize(merged), ["1597-03월: 1일 입력", "1597-09월: 1일 입력"]);
  assert.deepEqual(summarize(existing), []); // placeholder 는 입력으로 세지 않음
});

test("가져온 항목이 검증기를 통과, text_ko 는 translator 없으면 실패", () => {
  const tmp = mkdtempSync(join(tmpdir(), "yi-"));
  try {
    cpSync(SAMPLE, tmp, { recursive: true });
    const existing = JSON.parse(readFileSync(join(tmp, "diary_entries.json"), "utf-8"));
    const ok = parseSheet(`${HEAD}\n${row(3, 1)}`, OPT).entries;
    writeFileSync(join(tmp, "diary_entries.json"), JSON.stringify(mergeEntries(existing, ok)));
    assert.deepEqual(validateDir(tmp), []);

    const withKo = parseSheet(`${HEAD}\n${row(3, 2, { ko: "TEST-KO" })}`, OPT).entries;
    writeFileSync(join(tmp, "diary_entries.json"), JSON.stringify(mergeEntries(existing, withKo)));
    assert.ok(validateDir(tmp).some((e) => e.includes("translator")));

    const withTr = parseSheet(`${HEAD}\n${row(3, 2, { ko: "TEST-KO" })}`, { ...OPT, translator: "T" }).entries;
    writeFileSync(join(tmp, "diary_entries.json"), JSON.stringify(mergeEntries(existing, withTr)));
    assert.deepEqual(validateDir(tmp), []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
