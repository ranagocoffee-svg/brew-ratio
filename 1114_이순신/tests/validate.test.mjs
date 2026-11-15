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
