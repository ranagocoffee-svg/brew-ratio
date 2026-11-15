// 세계 트랙(35건) 규칙과 데이터 불변식. 연결 설명이 인용한 일기 문구가 실제 본문에 있는지까지 고정한다.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gregorianToJulian, gregorianToLunar } from "../tools/lunar.mjs";
import { validateDir } from "../tools/validate.mjs";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "sample", "nanjung");
const load = (f) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const events = load("events.json");
const entries = load("diary_entries.json").filter((e) => e.text_status !== "placeholder");
const wById = Object.fromEntries(events.map((e) => [e.id, e]));
const entryById = Object.fromEntries(entries.map((e) => [e.id, e]));
const world = events.filter((e) => e.track === "world");

function mutated(fname, fn) {
  const tmp = mkdtempSync(join(tmpdir(), "yi-"));
  try {
    cpSync(DIR, tmp, { recursive: true });
    const p = join(tmp, fname);
    const data = JSON.parse(readFileSync(p, "utf-8"));
    fn(data);
    writeFileSync(p, JSON.stringify(data), "utf-8");
    return validateDir(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
const ev = (d, id) => d.find((e) => e.id === id);

// ---- 검증기 규칙 ----
test("규칙: 세계 트랙은 region 필수, 이순신 트랙에는 region 금지, region 값은 enum", () => {
  assert.ok(mutated("events.json", (d) => { delete ev(d, "ev-1588-armada").region; }).some((e) => e.includes("region 이 필요")));
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1597-myeongnyang").region = "war"; }).some((e) => e.includes("region 을 쓰지 않음")));
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1588-armada").region = "asia"; }).some((e) => e.includes("허용되지 않은 값")));
});

test("규칙: relates_to 대상 없음·source_ids 비어 있음·없는 출처는 오류", () => {
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1593-haengju").relates_to.push("de-nope"); }).some((e) => e.includes("de-nope")));
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1588-armada").source_ids = []; }).some((e) => e.includes("source_ids 가 비어")));
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1588-armada").source_ids = ["src-nope"]; }).some((e) => e.includes("src-nope")));
});

test("규칙: 그레고리·율리우스 원본 표기와 저장된 날짜 필드가 다르면 오류", () => {
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1588-armada").date.gregorian = "1588-07-28"; }).some((e) => e.includes("원본(그레고리력)")));
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1571-lepanto").date.julian = "1571-10-08"; }).some((e) => e.includes("원본(율리우스력)")));
  // 율리우스 1571-10-07 이면 그레고리는 10-17(+10일)이어야 한다
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1571-lepanto").date.gregorian = "1571-10-18"; }).some((e) => e.includes("불일치")));
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1598-nantes").date.gregorian = "1598-05"; }).some((e) => e.includes("원본 연월")));
});

test("달력 변환 범위: 그레고리 1500-03-11 ~ 1700-02-28 은 -10일(1582 이전 사건 지원), 밖은 예외", () => {
  assert.equal(gregorianToJulian("1545-12-23"), "1545-12-13");
  assert.equal(gregorianToJulian("1571-10-17"), "1571-10-07");
  assert.equal(gregorianToJulian("1582-10-15"), "1582-10-05");
  assert.equal(gregorianToJulian("1500-03-11"), "1500-03-01");
  assert.throws(() => gregorianToJulian("1500-03-10"));
  assert.throws(() => gregorianToJulian("1700-03-01"));
});

// ---- 데이터 불변식 ----
test("세계 트랙 42건: 지역별(전쟁 21·동아시아 7·유럽 8·세계 교역 6), 전부 출처 보유", () => {
  assert.equal(world.length, 42);
  const c = {};
  for (const e of world) c[e.region] = (c[e.region] ?? 0) + 1;
  assert.deepEqual(c, { war: 21, east_asia: 7, europe: 8, global: 6 });
  for (const e of world) assert.ok(e.source_ids.length > 0, e.id);
});

const SILLOK_VERIFIED = ["ev-1593-pyongyang-retaken", "ev-1593-japan-leaves-hanseong", "ev-1593-jinju-2", "ev-1597-namwon", "ev-1598-hideyoshi-death-rumor", "ev-1598-dosan-withdrawal", "ev-1598-yegyo-withdrawal", "ev-1593-haengju", "ev-1597-kato-tadaepo", "ev-1592-daedong-crossing", "ev-1598-ulsan-siege", "ev-1598-ulsan-withdrawal", "ev-1598-suncheon-siege"];
test("세계 사건의 verified 는 근거가 있는 것만: 실록으로 확정 13건(사건 verified), 일기로 확정된 오보 기록 1건(날짜만), 한성 수복 1건은 disputed, 나머지는 unverified", () => {
  for (const e of world) {
    if (SILLOK_VERIFIED.includes(e.id)) {
      assert.equal(e.verified, true, e.id);
      assert.equal(e.date.certainty, "verified", e.id);
      assert.ok((e.date.basis_records ?? []).length > 0, `${e.id}: 실록 근거 필요`);
    } else if (e.id === "ev-1593-hanseong-retaken") {
      assert.equal(e.verified, false);
      assert.equal(e.date.certainty, "disputed"); // 위키 5/19 vs 명 측 서술 5/20
      assert.ok(!(e.date.basis_records ?? []).length);
    } else if (e.id === "ev-1596-hideyoshi-rumor") {
      assert.equal(e.verified, false);
      assert.equal(e.date.certainty, "verified");
      assert.ok((e.date.basis_entry_ids ?? []).length > 0);
    } else {
      assert.equal(e.verified, false, e.id);
      assert.equal(e.date.certainty, "unverified", e.id);
      assert.ok(!(e.date.basis_records ?? []).length, e.id);
    }
  }
});

test("1582 이전 서유럽 사건은 율리우스력 원본 + 10일 환산, 달력 미명시 메모 포함", () => {
  const dt = (id) => wById[id].date;
  assert.deepEqual([dt("ev-1545-trent").julian, dt("ev-1545-trent").gregorian], ["1545-12-13", "1545-12-23"]);
  assert.deepEqual([dt("ev-1571-manila").julian, dt("ev-1571-manila").gregorian], ["1571-06-24", "1571-07-04"]);
  assert.deepEqual([dt("ev-1571-lepanto").julian, dt("ev-1571-lepanto").gregorian], ["1571-10-07", "1571-10-17"]);
  for (const id of ["ev-1545-trent", "ev-1571-manila", "ev-1571-lepanto"]) {
    assert.equal(dt(id).original.calendar, "julian", id);
    assert.ok(dt(id).note.includes("미확인"), id);
  }
  assert.deepEqual([dt("ev-1588-armada").gregorian, dt("ev-1588-armada").julian], ["1588-07-29", "1588-07-19"]); // N.S. 07-29 = 영국 07-19
  assert.deepEqual([dt("ev-1582-gregorian").gregorian, dt("ev-1582-gregorian").julian], ["1582-10-15", "1582-10-05"]);
});

test("일자가 불확실한 사건(낭트 칙령·베르뱅)은 월 단위로만 두고, 출처 불일치를 메모에 남긴다", () => {
  assert.equal(wById["ev-1598-nantes"].date.precision, "month");
  assert.equal(wById["ev-1598-vervins"].date.precision, "month");
  assert.ok(wById["ev-1598-nantes"].date.note.includes("4/18") && wById["ev-1598-nantes"].date.note.includes("4/30"));
  assert.ok(wById["ev-1594-1598-dutch-asia-routes"].date.note.includes("1592")); // 원거리회사 설립 연도 불일치
});

test("전쟁 전반 사건: 위키 날짜를 음력으로 환산하면 한국에서 통용되는 음력 날짜와 맞는다", () => {
  const want = { "ev-1592-hanseong-falls": "5/3", "ev-1593-pyongyang-retaken": "1/8", "ev-1593-haengju": "2/12", "ev-1593-hanseong-retaken": "4/19", "ev-1593-jinju-2": "6/29", "ev-1597-second-invasion": "1/14", "ev-1597-namwon": "8/16", "ev-1598-suncheon-siege": "9/20" };
  for (const [id, w] of Object.entries(want)) {
    const l = gregorianToLunar(wById[id].date.gregorian);
    assert.equal(`${l.month}/${l.day}`, w, id);
  }
});

test("독립 교차 확인: 순천 공방 개시(위키 1598-10-19)와 일기 7책 9/20(일간지 壬寅로 확정)이 같은 날이고 서로 연결됨", () => {
  assert.equal(wById["ev-1598-suncheon-siege"].date.gregorian, "1598-10-19");
  assert.equal(wById["ev-1598-joint-assault"].date.gregorian, "1598-10-19");
  assert.equal(wById["ev-1598-joint-assault"].date.certainty, "verified");
  assert.ok(wById["ev-1598-suncheon-siege"].relates_to.includes("ev-1598-joint-assault"));
  assert.ok(wById["ev-1598-joint-assault"].relates_to.includes("ev-1598-suncheon-siege"));
  assert.ok(entryById["de-autograph-b7-1598-09-20"].text_han.includes("劉提督"));
});

test("노량↔일본군 철수·사천, 명량↔남원은 서로 연결(상호 참조)", () => {
  for (const [a, b] of [["ev-1598-noryang", "ev-1598-japan-leaves"], ["ev-1598-noryang", "ev-1598-sacheon"], ["ev-1597-myeongnyang", "ev-1597-namwon"]]) {
    assert.ok(wById[a].relates_to.includes(b), `${a}→${b}`);
    assert.ok(wById[b].relates_to.includes(a), `${b}→${a}`);
  }
});

test("연결 설명이 인용한 일기 문구는 실제 본문에 있고, 해당 날짜는 일간지로 확정된 항목이다", () => {
  const checks = [
    ["de-autograph-b4-1596-01-19", "沈惟敬", "ev-1596-shen-crossing"],
    ["de-autograph-b4-1596-04-19", "聞秀吉之死", "ev-1596-hideyoshi-rumor"],
    ["de-autograph-b4-1596-04-19", "但未可信", "ev-1596-hideyoshi-rumor"],
    ["de-autograph-b2-1593-07-13", "幸州之勝捷", "ev-1593-haengju"],
    ["de-autograph-b2-1593-06-29", "晋陽陷沒", "ev-1593-jinju-2"],
    ["de-autograph-b2-1593-08-26", "秀吉上書", "ev-1593-nagoya-talks"],
    ["de-autograph-b6-1597-11-16", "楊經理", "ev-1598-ulsan-siege"],
    ["de-autograph-b1-1593-02-16", "天兵", "ev-1593-pyongyang-retaken"],
  ];
  for (const [entryId, phrase, evId] of checks) {
    assert.ok(entryById[entryId].text_han.includes(phrase), `${entryId} 에 ${phrase} 없음`);
    assert.ok(wById[evId].relates_to.includes(entryId), `${evId} 가 ${entryId} 를 연결하지 않음`);
    assert.ok(entryById[entryId].day_ganji, entryId);
  }
  for (const id of ["de-autograph-b4-1596-01-19", "de-autograph-b4-1596-04-19", "de-autograph-b2-1593-07-13", "de-autograph-b2-1593-06-29", "de-autograph-b6-1597-11-16"]) assert.equal(entryById[id].date.certainty, "verified", id);
  // 오보 기록 사건의 날짜는 이 일기 항목의 양력과 같다
  assert.equal(wById["ev-1596-hideyoshi-rumor"].date.gregorian, entryById["de-autograph-b4-1596-04-19"].date.gregorian);
  // 히데요시 사망(1598) 시기의 일기 7책에서는 '秀吉'이 검출되지 않는다는 서술이 데이터와 맞는다
  assert.equal(entries.filter((e) => e.volume === "7책 무술일기" && e.text_han.includes("秀吉")).length, 0);
});
