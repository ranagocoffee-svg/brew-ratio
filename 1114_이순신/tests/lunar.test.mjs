import test from "node:test";
import assert from "node:assert/strict";
import { lunarToGregorian, gregorianToLunar } from "../tools/lunar.mjs";

// 기준값: crosscheck-2026-11-15.md 에 적힌 양력 환산 (문서 인용, 원문 재확인 전)
const ANCHORS = [
  [1545, 3, 8, "1545-04-28", "이순신 출생"],
  [1592, 4, 13, "1592-05-23", "임진왜란 개전"],
  [1592, 7, 8, "1592-08-14", "한산도 대첩"],
  [1598, 11, 19, "1598-12-16", "노량해전·전사"],
];

for (const [y, m, d, g, label] of ANCHORS) {
  test(`음력→양력: ${label}`, () => {
    assert.equal(lunarToGregorian(y, m, d).gregorian, g);
  });
  test(`양력→음력 왕복: ${label}`, () => {
    assert.deepEqual(gregorianToLunar(g), { year: y, month: m, day: d, leap: false });
  });
}

test("알려진 불일치: 명량 음력 9/16 은 변환기 10-25, 문서는 10-26 (하루 차이를 기록으로 남김)", () => {
  const r = lunarToGregorian(1597, 9, 16);
  assert.equal(r.gregorian, "1597-10-25");
  assert.equal(r.julian, "1597-10-15");
});

test("존재하지 않는 날짜는 null", () => {
  assert.equal(lunarToGregorian(1597, 13, 1), null);
  assert.equal(lunarToGregorian(1597, 2, 40), null);
});
