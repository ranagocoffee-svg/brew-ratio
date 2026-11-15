import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gregorianToJulian, validateDir } from "../tools/validate.mjs";

const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "sample", "nanjung");

function mutated(fname, fn) {
  const tmp = mkdtempSync(join(tmpdir(), "yi-"));
  try {
    cpSync(SAMPLE, tmp, { recursive: true });
    const p = join(tmp, fname);
    const data = JSON.parse(readFileSync(p, "utf-8"));
    fn(data);
    writeFileSync(p, JSON.stringify(data), "utf-8");
    return validateDir(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("그레고리력→율리우스력은 -10일", () => {
  assert.equal(gregorianToJulian("1597-10-26"), "1597-10-16");
  assert.equal(gregorianToJulian("1597-10-05"), "1597-09-25");
});

test("지원 범위 밖 날짜는 예외", () => {
  assert.throws(() => gregorianToJulian("1500-01-01"));
});

test("샘플 데이터는 통과", () => {
  assert.deepEqual(validateDir(SAMPLE), []);
});

test("존재하지 않는 출처 참조 탐지", () => {
  const errs = mutated("events.json", (d) => d[0].source_ids.push("src-nope"));
  assert.ok(errs.some((e) => e.includes("src-nope")));
});

test("율리우스력 불일치 탐지", () => {
  const errs = mutated("events.json", (d) => {
    d.find((e) => e.id === "ev-1597-myeongnyang").date.julian = "1597-10-26";
  });
  assert.ok(errs.some((e) => e.includes("불일치")));
});

test("변환기와 다른 양력은 disputed 로 명시해야 함 (근거 일기가 없을 때)", () => {
  const errs = mutated("events.json", (d) => {
    const ev = d.find((e) => e.id === "ev-1597-myeongnyang");
    ev.date.certainty = "unverified";
    delete ev.date.basis_entry_ids;
  });
  assert.ok(errs.some((e) => e.includes("disputed")));
});

test("일기 일간지로 확정된 사건 날짜는 변환기와 달라도 통과 (basis_entry_ids)", () => {
  assert.deepEqual(validateDir(SAMPLE), []); // 샘플의 명량: verified, 변환기와 +1일, 6책 9/16 근거
});

test("basis_entry_ids 근거가 사라지면 오류", () => {
  const errs = mutated("events.json", (d) => {
    d.find((e) => e.id === "ev-1597-myeongnyang").date.basis_entry_ids = ["de-nope"];
  });
  assert.ok(errs.some((e) => e.includes("basis_entry_ids")));
});

test("basis_entry_ids 근거 일기의 양력이 다르면 오류", () => {
  const errs = mutated("diary_entries.json", (d) => {
    const de = d.find((e) => e.id === "de-autograph-b6-1597-09-16");
    de.date.gregorian = "1597-10-25"; de.date.julian = "1597-10-15"; // 일간지(甲辰)와도 어긋남
  });
  assert.ok(errs.some((e) => e.includes("basis_entry_ids") || e.includes("일간지 불일치")));
});

test("같은 날짜라도 책(volume)이 다르면 중복이 아님, 같은 책이면 중복", () => {
  const errs = mutated("diary_entries.json", (d) => {
    const a = d.find((e) => e.id === "de-autograph-b6-1597-09-16");
    d.push({ ...a, id: "de-autograph-b6dup-1597-09-16" }); // 같은 판본·판독·책·날짜
  });
  assert.ok(errs.some((e) => e.includes("중복")));
});

test("computed_gregorian 이 재계산값과 다르면 오류", () => {
  const errs = mutated("events.json", (d) => {
    d.find((e) => e.id === "ev-1597-myeongnyang").date.computed_gregorian = "1597-10-27";
  });
  assert.ok(errs.some((e) => e.includes("재계산값")));
});

test("verified=true 는 certainty=verified 필요", () => {
  const errs = mutated("events.json", (d) => { d[0].verified = true; });
  assert.ok(errs.some((e) => e.includes("verified=true")));
});

test("기준 판본은 정확히 1개", () => {
  const errs = mutated("editions.json", (d) => { d[0].is_base = true; });
  assert.ok(errs.some((e) => e.includes("is_base")));
});

test("필수 필드 누락 탐지", () => {
  const errs = mutated("events.json", (d) => { delete d[0].title_ko; });
  assert.ok(errs.some((e) => e.includes("title_ko")));
});

// ---- 판독 쟁점 카드 규칙 ----
test("쟁점 카드: 출현 위치의 판독 글자가 실제 본문에 없으면 오류", () => {
  const errs = mutated("reading_issues.json", (d) => { d[0].occurrences[0].portal_reading = "存在しない"; });
  assert.ok(errs.some((e) => e.includes("portal_reading")));
});

test("쟁점 카드: context 가 본문에 없거나 판독 글자를 포함하지 않으면 오류", () => {
  const e1 = mutated("reading_issues.json", (d) => { d[0].occurrences[0].context = "본문에 없는 문맥 女眞"; });
  assert.ok(e1.some((e) => e.includes("context")));
  const e2 = mutated("reading_issues.json", (d) => { d[0].occurrences[0].context = "暮到茂長宿"; });
  assert.ok(e2.some((e) => e.includes("portal_reading 이 포함")));
});

test("쟁점 카드: 주장(claim)·해석에 출처가 없으면 오류 (주장은 출처 필수)", () => {
  const e1 = mutated("reading_issues.json", (d) => { d[0].readings.find((r) => r.status === "claim").source_ids = []; });
  assert.ok(e1.some((e) => e.includes("주장(claim)에는 source_ids")));
  const e2 = mutated("reading_issues.json", (d) => { d[0].interpretations[0].source_ids = []; });
  assert.ok(e2.some((e) => e.includes("해석에는 source_ids")));
  const e3 = mutated("reading_issues.json", (d) => { d[0].history[0].source_ids = []; });
  assert.ok(e3.some((e) => e.includes("history")));
});

test("쟁점 카드: 존재하지 않는 출처·일기 항목, 엉뚱한 per_entry 키, 스키마 위반 탐지", () => {
  assert.ok(mutated("reading_issues.json", (d) => { d[0].readings[1].source_ids.push("src-nope"); }).some((e) => e.includes("src-nope")));
  assert.ok(mutated("reading_issues.json", (d) => { d[0].occurrences[0].entry_id = "de-nope"; }).some((e) => e.includes("de-nope")));
  assert.ok(mutated("reading_issues.json", (d) => { d[0].readings[1].per_entry["de-autograph-b4-1596-09-16"] = "女眞"; }).some((e) => e.includes("per_entry")));
  assert.ok(mutated("reading_issues.json", (d) => { d[0].status = "undecided"; }).some((e) => e.includes("허용되지 않은 값")));
  assert.ok(mutated("reading_issues.json", (d) => { delete d[0].summary; }).some((e) => e.includes("summary")));
});
