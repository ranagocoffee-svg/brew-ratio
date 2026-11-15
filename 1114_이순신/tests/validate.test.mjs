import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gregorianToJulian, validateDir } from "../tools/validate.mjs";

const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "sample", "1597");

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

test("변환기와 다른 양력은 disputed 로 명시해야 함", () => {
  const errs = mutated("events.json", (d) => {
    d.find((e) => e.id === "ev-1597-myeongnyang").date.certainty = "unverified";
  });
  assert.ok(errs.some((e) => e.includes("disputed")));
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
