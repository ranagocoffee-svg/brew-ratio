// 외부 기록(선조실록 등) 근거: 헤더 일간지 확정, 인용 날짜에서 사건 날짜 도출, 검증 규칙.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ganjiOfIso, addDays } from "../tools/lunar.mjs";
import { validateDir } from "../tools/validate.mjs";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "sample", "nanjung");
const load = (f) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));
const records = load("records.json");
const events = load("events.json");
const entries = load("diary_entries.json");
const rById = Object.fromEntries(records.map((r) => [r.id, r]));
const eById = Object.fromEntries(events.map((e) => [e.id, e]));

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

test("실록 기사 24건: 헤더 일간지가 그날의 실제 일간지와 일치하고 날짜는 verified (일기와 같은 방식의 확정)", () => {
  assert.equal(records.length, 24);
  const want = {
    "rec-sillok-seonjo-29-01-21-002": ["戊子", "1596-02-18"],
    "rec-sillok-seonjo-31-10-01-006": ["癸丑", "1598-10-30"],
    "rec-sillok-seonjo-31-09-26-011": ["戊申", "1598-10-25"],
    "rec-sillok-seonjo-30-12-28-004": ["甲申", "1598-02-03"], "rec-sillok-seonjo-31-01-09-003": ["乙未", "1598-02-14"],
    "rec-sillok-seonjo-26-04-26-004": ["庚戌", "1593-05-26"],
    "rec-sillok-seonjo-25-06-18-006": ["丙午", "1592-07-26"], "rec-sillok-seonjo-25-06-26-002": ["甲寅", "1592-08-03"],
    "rec-sillok-seonjo-30-01-23-003": ["甲寅", "1597-03-10"],
    "rec-sillok-seonjo-31-09-06-006": ["戊子", "1598-10-05"], "rec-sillok-seonjo-34-04-25-011": ["壬辰", "1601-05-26"],
    "rec-sillok-seonjo-31-11-27-005": ["戊申", "1598-12-24"], "rec-sillok-seonjo-31-11-25-009": ["丙午", "1598-12-22"],
    "rec-sillok-seonjo-30-01-21-001": ["壬子", "1597-03-08"],
    "rec-sillok-seonjo-26-02-24-006": ["己酉", "1593-03-26"],
    "rec-sillok-seonjo-31-09-15-002": ["丁酉", "1598-10-14"], "rec-sillok-seonjo-31-11-23-004": ["甲辰", "1598-12-20"], "rec-sillok-seonjo-31-11-24-005": ["乙巳", "1598-12-21"], "rec-sillok-seonjo-31-11-25-007": ["丙午", "1598-12-22"], "rec-sillok-seonjo-31-12-01-004": ["壬子", "1598-12-28"], "rec-sillok-seonjo-26-01-11-013": ["丙寅", "1593-02-11"], "rec-sillok-seonjo-26-04-21-005": ["乙巳", "1593-05-21"], "rec-sillok-seonjo-26-07-16-005": ["戊辰", "1593-08-12"], "rec-sillok-seonjo-30-08-18-002": ["丙子", "1597-09-28"] };
  for (const [id, [gj, g]] of Object.entries(want)) {
    assert.equal(rById[id].day_ganji, gj, id);
    assert.equal(rById[id].date.gregorian, g, id);
    assert.equal(ganjiOfIso(g), gj, id);
    assert.equal(rById[id].date.certainty, "verified", id);
  }
});

test("인용은 짧게(125자 이하), 국역을 수록하지 않는다는 원칙이 기록에 명시된다", () => {
  for (const r of records) {
    for (const s of r.statements) if (s.text_han) assert.ok(s.text_han.length <= 125, `${r.id}: ${s.text_han.length}자`);
    assert.ok(r.note.includes("국역은 수록하지 않고"), r.id);
    assert.ok(r.url.startsWith("https://sillok.history.go.kr/id/"), r.id);
  }
});

test("인용된 음력 날짜에서 도출한 양력이 사건 날짜와 일치 (같은 달: 기록일 ± 일수, 다른 달: 확정된 일기로 연결)", () => {
  const derive = (br) => {
    const r = rById[br.record_id], st = r.statements[br.statement];
    if (br.bridge_entry_id) return entries.find((e) => e.id === br.bridge_entry_id).date.gregorian;
    return addDays(r.date.gregorian, st.stated_lunar.day - r.date.original.day);
  };
  const expect = { "ev-1593-pyongyang-retaken": "1593-02-08", "ev-1593-haengju": "1593-03-14", "ev-1597-kato-tadaepo": "1597-02-28", "ev-1598-noryang": "1598-12-16", "ev-1592-daedong-crossing": "1592-07-22", "ev-1598-ulsan-siege": "1598-01-29", "ev-1598-suncheon-siege": "1598-10-19", "ev-1598-sacheon-dong-attack": "1598-10-27", "ev-1598-ulsan-withdrawal": "1598-02-09", "ev-1593-japan-leaves-hanseong": "1593-05-18", "ev-1593-jinju-2": "1593-07-27", "ev-1597-namwon": "1597-09-26", "ev-1598-dosan-withdrawal": "1598-12-15", "ev-1598-yegyo-withdrawal": "1598-12-16" };
  for (const [id, g] of Object.entries(expect)) {
    const brs = eById[id].date.basis_records;
    assert.ok(brs.length > 0, id);
    for (const br of brs) assert.equal(derive(br), g, id);
    assert.equal(eById[id].date.gregorian, g, id);
  }
  // 진주성은 6월(기록은 7월)이라 일기 2책 6/29(일간지 확정)로 이었다
  assert.equal(eById["ev-1593-jinju-2"].date.basis_records[0].bridge_entry_id, "de-autograph-b2-1593-06-29");
});

test("실록과 위키 연표가 일치/불일치하는 지점이 기록돼 있다 (한성 철수 일치, 명군 입성일 disputed, 남원 포위 하루 차이)", () => {
  assert.equal(eById["ev-1593-japan-leaves-hanseong"].date.gregorian, "1593-05-18"); // 위키 'abandoned it on 18 May'
  assert.equal(eById["ev-1593-hanseong-retaken"].date.certainty, "disputed"); // 위키 5/19 vs 명 측 서술 4/20(5/20)
  assert.ok(eById["ev-1593-hanseong-retaken"].date.note.includes("입성일(4/19)은 실록으로 확인되지 않는다"));
  assert.ok(eById["ev-1597-namwon"].date.note.includes("하루 차이"));
  assert.ok(eById["ev-1593-jinju-2"].date.note.includes("함락일을 직접 명시하지는 않음"));
  const nam = rById["rec-sillok-seonjo-30-08-18-002"];
  assert.ok(nam.note.includes("우리의 추론")); // 16일 밤을 함락 시점으로 읽은 것은 추론
});

test("규칙: basis_records 의 기록·인덱스·도출 날짜·달 경계가 잘못되면 오류", () => {
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1593-japan-leaves-hanseong").date.basis_records[0].record_id = "rec-nope"; }).some((e) => e.includes("rec-nope")));
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1593-japan-leaves-hanseong").date.basis_records[0].statement = 9; }).some((e) => e.includes("statements[9]")));
  assert.ok(mutated("events.json", (d) => { const e = ev(d, "ev-1593-japan-leaves-hanseong"); e.date.gregorian = "1593-05-19"; e.date.original.day = 19; e.date.julian = "1593-05-09"; }).some((e) => e.includes("도출한 양력")));
  // 다른 달인데 연결 일기 항목이 없으면 오류
  assert.ok(mutated("events.json", (d) => { delete ev(d, "ev-1593-jinju-2").date.basis_records[0].bridge_entry_id; }).some((e) => e.includes("bridge_entry_id")));
  // 연결 일기 항목의 음력 날짜가 인용된 날짜와 다르면 오류
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1593-jinju-2").date.basis_records[0].bridge_entry_id = "de-autograph-b2-1593-07-01"; }).some((e) => e.includes("음력 날짜가 인용된 날짜")));
});

test("규칙: 근거 없는 세계 사건을 verified 로 올리면 오류, 기록 날짜가 확정되지 않으면 근거로 못 쓴다", () => {
  assert.ok(mutated("events.json", (d) => { const e = ev(d, "ev-1588-armada"); e.date.certainty = "verified"; }).some((e) => e.includes("근거가 필요")));
  assert.ok(mutated("events.json", (d) => { ev(d, "ev-1588-armada").verified = true; }).some((e) => e.includes("verified=true 인 세계 사건")));
  assert.ok(mutated("records.json", (d) => { d[0].date.certainty = "unverified"; }).some((e) => e.includes("확정되지 않음") || e.includes("일간지로 확정")));
});

test("규칙: 기록 헤더 일간지가 달력과 다르거나 인용이 125자를 넘으면 오류", () => {
  assert.ok(mutated("records.json", (d) => { d[0].day_ganji = "甲子"; }).some((e) => e.includes("일간지")));
  assert.ok(mutated("records.json", (d) => { d[0].statements[0].text_han = "字".repeat(126); }).some((e) => e.includes("125자")));
  assert.ok(mutated("records.json", (d) => { d[0].source_id = "src-nope"; }).some((e) => e.includes("src-nope")));
  assert.ok(mutated("records.json", (d) => { delete d[0].day_ganji; }).some((e) => e.includes("day_ganji")));
});

test("선조실록 출처는 확인됨(confirmed)으로 바뀌었고 국역 저작권 주의가 적혀 있다", () => {
  const s = load("sources.json").find((x) => x.id === "src-seonjo-sillok");
  assert.equal(s.status, "confirmed");
  assert.ok(s.url.startsWith("https://sillok.history.go.kr"));
  assert.ok(s.note.includes("저작권"));
});
