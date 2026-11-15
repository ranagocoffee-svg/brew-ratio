// 샘플 데이터(1592-1598)의 핵심 불변식. 데이터를 다시 가져오거나 분할기를 고칠 때 회귀를 잡는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ganjiOfIso } from "../tools/lunar.mjs";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "sample", "nanjung");
const load = (f) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const entries = load("diary_entries.json").filter((e) => e.text_status !== "placeholder");
const events = load("events.json");
const vol = (v, year) => entries.filter((e) => e.volume === v && (year == null || e.date.original.year === year));
const key = (e) => e.date.original.month * 100 + e.date.original.day;

test("책별 입력 일수 (5책 4/1~10/8, 6책 8/6~1598 1/4, 7책 9/15~10/7)", () => {
  assert.equal(vol("5책 정유일기").length, 184);
  assert.equal(vol("6책 속정유일기", 1597).length, 141);
  assert.equal(vol("6책 속정유일기", 1598).length, 4);
  assert.equal(vol("7책 무술일기").length, 23);
});

test("4책 병신일기: 1596 1/1~10/11 305일(윤8월 28일 포함), 전부 verified·변환기 일치", () => {
  const b4 = vol("4책 병신일기");
  assert.equal(b4.length, 305);
  assert.equal(b4.filter((e) => e.date.original.leap_month).length, 28);
  for (const e of b4) {
    assert.equal(e.date.original.year, 1596, e.id);
    assert.equal(e.date.certainty, "verified", e.id);
    assert.equal(e.date.gregorian, e.date.computed_gregorian, e.id);
    assert.equal(e.date.ganji_check, undefined, e.id);
  }
  // 윤8월 초하루: 乙丑 = 1596-09-22. 윤달 id 는 L 표기.
  const l1 = b4.find((e) => e.id === "de-autograph-b4-1596-L08-01");
  assert.equal(l1.day_ganji, "乙丑");
  assert.equal(l1.date.gregorian, "1596-09-22");
});

test("4책: 일기가 없는 날은 6/24 와 윤8/24 뿐 (月 안에서 빠진 날 검사)", () => {
  const b4 = vol("4책 병신일기");
  const missing = [];
  for (const e of b4) {
    const o = e.date.original;
    const prev = b4.find((x) => x.date.original.month === o.month && !!x.date.original.leap_month === !!o.leap_month && x.date.original.day === o.day - 1);
    if (o.day > 1 && !prev) missing.push(`${o.leap_month ? "윤" : ""}${o.month}/${o.day - 1}`);
  }
  assert.deepEqual(missing, ["6/24", "윤8/24"]);
});

test("본문 정리: 주석 번호·면 라벨(빈면/표지) 없음, 4책 끝 부록은 제외(10/11 = 晴)", () => {
  for (const e of entries) {
    assert.ok(!/\d\)/.test(e.text_han), `${e.id} 주석 번호`);
    assert.ok(!/빈면|표지/.test(e.text_han), `${e.id} 면 라벨`);
  }
  assert.equal(entries.find((e) => e.id === "de-autograph-b4-1596-10-11").text_han, "晴");
});

test("4책 9월 '女眞' 표기 위치 (판독 쟁점 후보: 9/12, 9/14, 9/15) — 본문을 고치지 않고 그대로 보존", () => {
  const hits = vol("4책 병신일기").filter((e) => e.text_han.includes("女眞")).map((e) => `${e.date.original.month}/${e.date.original.day}`);
  assert.deepEqual(hits, ["9/12", "9/14", "9/15"]);
});

test("30일을 卅/三十 로 적은 날도 읽힘 (5책 8/30, 6책 1597-12-30)", () => {
  const a = entries.find((e) => e.id === "de-autograph-b5-1597-08-30");
  const b = entries.find((e) => e.id === "de-autograph-b6-1597-12-30");
  assert.ok(a && b);
  assert.equal(b.day_ganji, "丙戌");
  assert.equal(b.date.gregorian, "1598-02-05"); // 입춘 기록이 있는 날
});

test("월 머리('九月' 등)가 앞 일기 본문 끝에 남지 않음", () => {
  const tails = entries.filter((e) => /[正一二三四五六七八九十]{1,2}月$/.test(e.text_han));
  assert.deepEqual(tails.map((e) => e.id), []);
});

test("6책·7책(1598 포함)은 일간지가 전부 달력과 일치(verified), ganji_check 없음", () => {
  const set = [...vol("6책 속정유일기"), ...vol("7책 무술일기")];
  assert.ok(set.length > 0);
  for (const e of set) {
    assert.equal(e.date.certainty, "verified", e.id);
    assert.equal(e.date.ganji_check, undefined, e.id);
    assert.equal(ganjiOfIso(e.date.gregorian), e.day_ganji, e.id);
  }
});

test("1598년 일기는 변환기와 같은 양력 (1597 9월 같은 표 오류가 없음)", () => {
  for (const e of entries.filter((x) => x.date.original.year === 1598)) {
    assert.equal(e.date.gregorian, e.date.computed_gregorian, e.id);
  }
});

test("5책과 6책이 겹치는 62일은 양력이 모두 같고 본문은 다르다", () => {
  const m5 = new Map(vol("5책 정유일기").map((e) => [key(e), e]));
  const both = vol("6책 속정유일기", 1597).filter((e) => m5.has(key(e)));
  assert.equal(both.length, 62);
  for (const e of both) {
    const o = m5.get(key(e));
    assert.equal(o.date.gregorian, e.date.gregorian, e.id);
    assert.notEqual(o.text_han, e.text_han, e.id);
  }
});

test("5책 7/4~10/3 의 간지 불일치는 천간이 맞고 지지가 +2 (전부 같은 이동량)", () => {
  const bad = vol("5책 정유일기").filter((e) => e.date.ganji_check);
  assert.ok(bad.length > 80);
  for (const e of bad) {
    assert.equal(e.date.ganji_check.stem_match, true, e.id);
    assert.equal(e.date.ganji_check.branch_shift, 2, e.id);
  }
});

test("명량: 6책 9/1=己丑=10/11, 9/16=甲辰=10/26 이고 사건 날짜의 근거로 연결됨", () => {
  const e1 = entries.find((e) => e.id === "de-autograph-b6-1597-09-01");
  const e16 = entries.find((e) => e.id === "de-autograph-b6-1597-09-16");
  assert.equal(e1.date.gregorian, "1597-10-11");
  assert.equal(e16.date.gregorian, "1597-10-26");
  const ev = events.find((e) => e.id === "ev-1597-myeongnyang");
  assert.equal(ev.date.gregorian, "1597-10-26");
  assert.equal(ev.date.certainty, "verified");
  assert.ok(ev.date.basis_entry_ids.includes("de-autograph-b6-1597-09-16"));
});

test("1598 사건: 일기 근거 사건은 verified, 일기 밖 사건은 unverified (노량은 실록 근거로 verified)", () => {
  const nor = events.find((e) => e.id === "ev-1598-noryang");
  assert.equal(nor.date.certainty, "verified");
  assert.equal(nor.date.gregorian, "1598-12-16");
  assert.ok(nor.date.basis_records.length > 0);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  for (const id of ["ev-1598-fleet-departure", "ev-1598-joint-assault"]) {
    assert.equal(byId[id].date.certainty, "verified", id);
    assert.ok(byId[id].date.basis_entry_ids.length > 0, id);
  }
  for (const id of ["ev-1598-hideyoshi-death", "ev-1598-nantes"]) {
    assert.equal(byId[id].date.certainty, "unverified", id);
    assert.equal(byId[id].verified, false, id);
  }
});

// ---- 1책~3책 (1592~1594) ----
const inMonthMissing = (es) => {
  const sorted = [...es].sort((a, b) => key(a) - key(b));
  const miss = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].date.original, b = sorted[i].date.original;
    if (a.month === b.month && !a.leap_month && b.day - a.day > 1) for (let d = a.day + 1; d < b.day; d++) miss.push(`${a.month}/${d}`);
  }
  return miss;
};

test("1~3책 입력 일수 (1책 1592 19 / 1593 49, 2책 127, 3책 315)", () => {
  assert.equal(vol("1책 임진일기", 1592).length, 19);
  assert.equal(vol("1책 임진일기", 1593).length, 49);
  assert.equal(vol("2책 계사일기").length, 127);
  assert.equal(vol("3책 갑오일기").length, 315);
});

test("1책 1592: 일간지 없는 머리 → 전부 unverified, 날짜는 변환기 계산값", () => {
  for (const e of vol("1책 임진일기", 1592)) {
    assert.equal(e.day_ganji, null, e.id);
    assert.equal(e.date.certainty, "unverified", e.id);
    assert.equal(e.date.gregorian, e.date.computed_gregorian, e.id);
  }
  const days = vol("1책 임진일기", 1592).map((e) => `${e.date.original.month}/${e.date.original.day}`);
  assert.deepEqual(days.filter((d) => d.startsWith("8/")), ["8/24", "8/25", "8/26", "8/27", "8/28"]);
  assert.ok(days.includes("5/29") && days.includes("6/9") && !days.includes("5/5"));
});

test("1책 1593: 2월 30일 + 3월 19일, 전부 verified, 판독문 월 머리 '二月'은 3월로 보정", () => {
  const e = vol("1책 임진일기", 1593);
  assert.equal(e.filter((x) => x.date.original.month === 2).length, 30);
  assert.equal(e.filter((x) => x.date.original.month === 3).length, 19);
  for (const x of e) assert.equal(x.date.certainty, "verified", x.id);
  assert.equal(e.find((x) => x.date.original.month === 2 && x.date.original.day === 1).date.gregorian, "1593-03-03"); // 丙戌
  const m31 = e.find((x) => x.date.original.month === 3 && x.date.original.day === 1);
  assert.equal(m31.day_ganji, "丙辰");
  assert.equal(m31.date.gregorian, "1593-04-02");
  assert.ok(m31.note.includes("3월로 배정"));
  assert.deepEqual(inMonthMissing(e), ["3/17"]);
});

test("2책: 5/1~9/14 전부 verified, 빠진 날 5개, 9/14 본문에 9/15 부록이 섞이지 않음, 괄호 머리 8건 보존", () => {
  const b2 = vol("2책 계사일기");
  for (const e of b2) { assert.equal(e.date.certainty, "verified", e.id); assert.equal(e.date.gregorian, e.date.computed_gregorian, e.id); }
  assert.deepEqual(inMonthMissing(b2), ["5/3", "5/7", "5/25", "5/26", "7/21"]);
  const last = b2.find((e) => e.date.original.month === 9 && e.date.original.day === 14);
  assert.ok(last.text_han.endsWith("順天還來"));
  assert.ok(!last.text_han.includes("夷性輕剽"));
  assert.equal(b2.filter((e) => e.note && e.note.includes("괄호 글자")).length, 8);
});

test("3책: 1/1~11/28 315일, 이의는 5/8(己酉≠乙酉) 한 건뿐", () => {
  const b3 = vol("3책 갑오일기");
  const odd = b3.filter((e) => e.date.certainty !== "verified");
  assert.deepEqual(odd.map((e) => e.id), ["de-autograph-b3-1594-05-08"]);
  assert.equal(odd[0].date.ganji_check.expected, "乙酉");
  assert.equal(odd[0].date.ganji_check.stem_match, false);
  assert.deepEqual(inMonthMissing(b3), ["2/23", "2/24", "2/25", "2/26", "2/27", "7/20", "7/23"]);
  const last = [...b3].sort((a, b) => key(a) - key(b)).at(-1);
  assert.equal(`${last.date.original.month}/${last.date.original.day}`, "11/28");
});

test("1592 사건 4건: 문서 날짜와 변환기 일치, 일기 공백이라 unverified", () => {
  for (const id of ["ev-1592-war-begins", "ev-1592-okpo", "ev-1592-hansando", "ev-1592-busanpo"]) {
    const ev = events.find((e) => e.id === id);
    assert.ok(ev, id);
    assert.equal(ev.date.certainty, "unverified", id);
    assert.equal(ev.verified, false, id);
    assert.equal(ev.date.gregorian, ev.date.computed_gregorian, id);
  }
  // 이 사건들의 음력 날짜에 해당하는 일기는 현존 초고본에 없다
  const has = (m, d) => entries.some((e) => e.date.original.year === 1592 && e.date.original.month === m && e.date.original.day === d);
  assert.ok(!has(5, 7) && !has(7, 8) && !has(9, 1));
});

// ---- 판독 쟁점 카드 (女眞 등) ----
const issues = load("reading_issues.json");
const issue = (id) => issues.find((x) => x.id === id);
const countIn = (re) => entries.reduce((n, e) => n + (e.text_han.match(re) || []).length, 0);

test("女眞 카드: 출현 위치 3곳(9/12, 9/14, 9/15)이 데이터와 정확히 일치하고 다른 곳에는 없다", () => {
  const c = issue("ri-1596-yeojin");
  assert.deepEqual(c.occurrences.map((o) => [o.entry_id, o.portal_reading]), [
    ["de-autograph-b4-1596-09-12", "女眞"], ["de-autograph-b4-1596-09-14", "女眞卄"], ["de-autograph-b4-1596-09-15", "女眞卅"],
  ]);
  assert.equal(countIn(/女眞/g), 3); // 카드의 "이 세 곳에만" 서술을 데이터가 뒷받침
  for (const o of c.occurrences) {
    const e = entries.find((x) => x.id === o.entry_id);
    assert.equal(e.date.certainty, "verified", o.entry_id); // 날짜는 일간지로 확정된 날
    assert.ok(e.text_han.endsWith(o.portal_reading), `${o.entry_id}: 항목 끝에 있다는 서술`);
  }
});

test("女眞 카드: 관찰 서술의 숫자(일기 수, 卄·卅 횟수, 共 끝맺음)가 데이터와 맞는다", () => {
  const text = issue("ri-1596-yeojin").observations.map((o) => o.text).join("\n");
  assert.equal(entries.length, 1167);
  assert.ok(text.includes("1,167일"));
  assert.equal(countIn(/卄/g), 21);
  assert.equal(countIn(/卅/g), 10);
  assert.ok(text.includes("卄'(21회)") && text.includes("卅'(10회)"));
  const endsWithGong = entries.filter((e) => e.text_han.endsWith("共")).map((e) => e.id).sort();
  assert.deepEqual(endsWithGong, ["de-autograph-b2-1593-08-14", "de-autograph-b4-1596-03-09", "de-autograph-b4-1596-07-05"]);
  assert.ok(text.includes("3건 더"));
});

test("女眞 카드: 읽기 3종(포털 observed, 박종평·노승석 claim), 미해결 상태, 주의문, 확인 과제", () => {
  const c = issue("ri-1596-yeojin");
  assert.equal(c.status, "unresolved");
  assert.ok(c.caution && c.caution.includes("판정하지 않는다"));
  assert.deepEqual(c.readings.map((r) => [r.id, r.status]), [["rdg-portal", "observed"], ["rdg-park", "claim"], ["rdg-noh", "claim"]]);
  assert.ok(c.readings.filter((r) => r.status === "claim").every((r) => r.source_ids.length > 0));
  assert.ok(c.to_resolve.length >= 5);
  // 포털 판독문과 박종평이 설명한 글자는 같고, 노승석은 卄·卅 를 共 로 읽는다
  const [portal, park, noh] = c.readings;
  assert.deepEqual(portal.per_entry, park.per_entry);
  assert.equal(noh.per_entry["de-autograph-b4-1596-09-14"], "女眞共");
  assert.equal(noh.per_entry["de-autograph-b4-1596-09-12"], undefined); // 9/12 는 보도에서 언급 확인 못 함
});

test("內山月 카드: '歲山月'은 일기 전체에서 9/11 한 곳에만 있고 '萊山月'은 보도 표기로만 존재", () => {
  const c = issue("ri-1596-naesanwol");
  assert.equal(c.occurrences.length, 1);
  assert.equal(countIn(/歲山月/g), 1);
  assert.equal(countIn(/萊山月/g), 0); // 포털 판독문에는 없다
  assert.equal(c.readings.find((r) => r.id === "rdg-segye").status, "claim");
  assert.equal(c.status, "unresolved");
});
