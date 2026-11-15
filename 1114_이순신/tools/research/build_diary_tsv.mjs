// 국가유산포털 원문 줄(book<N>.json) -> 일별 일기 분할 -> 입력 시트(TSV).
// 분할 기준: '<날짜>日[<일간지>]' 머리. 날짜 번호가 1차 기준이고 일간지 연속성은 이상 징후로만 기록한다(일기 자체의 간지 오기 가능).
// 사용법: node tools/research/build_diary_tsv.mjs <책번호> <시작 음력 월> <출력.tsv> <시작 일>
//         [--start-year N] [--only YEAR] [--tail-cut <문자열>] [--no-ganji] [--segments <파일.json>] [--report]
//   --start-year : 시작 연도(기본: 책별 값). 월 머리의 간지 연도 표기(壬辰·癸巳…)가 나오면 갱신한다.
//   --only       : 이 연도의 항목만 출력(기본: 시작 연도). 한 책이 두 해에 걸치면 연도별로 따로 출력한다.
//   --tail-cut   : 마지막 일기 뒤에 붙은 비일기 부록(장부·메모)을 첫 출현 위치에서 잘라 낸다.
//   --no-ganji   : 일간지 없는 날짜 머리도 인정(날씨 글자가 뒤따르거나 월 머리 바로 뒤일 때만).
//   --segments   : 구간 지정 파일. 1책처럼 한 책 안에서 연·월·형식(일간지 유무)이 구간마다 다르고 장계 초안이 끼어 있을 때,
//                  구간별로 {from, to, year, month, startDay, noGanji}를 지정한다(from/to 는 판독문 속 문자열 앵커).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const [bookArg, startMonthArg, outArg] = argv;
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const report = argv.includes("--report");
const allowNoGanji = argv.includes("--no-ganji");
const book = JSON.parse(readFileSync(join(ROOT, "data", "input", "heritage", `book${bookArg}.json`), "utf-8"));

const START_YEAR = { 1: 1592, 2: 1593, 3: 1594, 4: 1596, 5: 1597, 6: 1597, 7: 1598 };
const YEAR_OF = { 壬辰: 1592, 癸巳: 1593, 甲午: 1594, 乙未: 1595, 丙申: 1596, 丁酉: 1597, 戊戌: 1598 };
const startYear = Number(opt("--start-year") ?? START_YEAR[bookArg] ?? 1597);
const onlyYear = Number(opt("--only") ?? startYear);
const tailCut = opt("--tail-cut");
const startDay = Number(argv[3] && !argv[3].startsWith("--") ? argv[3] : 1);
const segmentsFile = opt("--segments");

const GAN = "甲乙丙丁戊己庚辛壬癸", JI = "子丑寅卯辰巳午未申酉戌亥";
const gIdx = (s) => { for (let i = 0; i < 60; i++) if (GAN[i % 10] === s[0] && JI[i % 12] === s[1]) return i; return -1; };
const DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function dayNum(tok) {
  const t = tok.replace(/^初/, "");
  if (t === "卅" || t === "三十") return 30;
  if (t === "十") return 10;
  if (t === "二十") return 20;
  if (/^十./.test(t)) return 10 + DIGIT[t[1]];
  if (/^二十./.test(t)) return 20 + DIGIT[t[2]];
  if (/^[廿卄念]./.test(t)) return 20 + (DIGIT[t[1]] ?? 0);
  if (/^[廿卄念]$/.test(t)) return 20;
  return DIGIT[t] ?? NaN;
}
const DAYSRC = "初?[一二三四五六七八九]|十[一二三四五六七八九]?|二十[一二三四五六七八九]?|[廿卄念][一二三四五六七八九]?|三十|卅";
// '<날짜>日' 뒤에 일간지가 올 수도, 안 올 수도 있다. 일간지 가운데 괄호 글자가 낀 표기('癸(酉)巳')도 읽는다.
const HEAD = new RegExp(`(${DAYSRC})日(?:([甲乙丙丁戊己庚辛壬癸])(?:\\(([^()]{1,3})\\))?([子丑寅卯辰巳午未申酉戌亥]))?`, "g");
// 일간지 없는 머리는 가짜가 많아('初一日入京', '十日也') 날씨 글자가 뒤따르거나 월 머리 바로 뒤일 때만 인정한다.
const WEATHER = /^\s?(晴|雨|陰|雪|風|霧|曇|細雨|大雨|或|終日|大風)/;

const MONTH = { 正: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
const YEAR_RE = "壬辰|癸巳|甲午|乙未|丙申|丁酉|戊戌";
/** 초하루 머리 바로 앞의 연·월 표기. 예: '…九月', '…閏八月', '戊戌正月甲寅', '壬辰五月'. */
function monthHeader(before) {
  // '四月 初一日'처럼 월 표기와 날짜 사이에 공백이 있는 경우도 읽는다(\s?).
  const m = new RegExp(`(${YEAR_RE})?(閏)?([正一二三四五六七八九]|十[一二]?)月(?:[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])?\\s?$`).exec(before);
  return m ? { year: m[1] ? YEAR_OF[m[1]] : null, month: MONTH[m[3]], leap: Boolean(m[2]) } : null;
}

// 문자 스트림(쪽 추적). 줄은 공백 없이 이어 붙인다(지면 줄바꿈은 문장 중간일 수 있음).
// 포털은 펼침면(2쪽) 단위로 보여주므로 인접한 두 쪽 요청이 같은 줄을 돌려준다. 동일한 줄 목록은 한 번만 쓴다.
let stream = "";
const pageAt = [];
let prevKey = null;
for (const pg of book.pages) {
  const key = JSON.stringify(pg.lines);
  if (key === prevKey) continue;
  prevKey = key;
  for (const line of pg.lines) {
    if (line === "빈면" || line === "빈 면" || line === "표지") continue; // 포털의 면 라벨(본문 아님)
    for (const ch of line) { stream += ch; pageAt.push(pg.page); }
  }
}

// 구간 정의: 기본은 책 전체 한 구간. --segments 가 있으면 앵커 문자열로 구간을 자른다.
let regions;
if (segmentsFile) {
  const segs = JSON.parse(readFileSync(resolve(segmentsFile), "utf-8"));
  regions = segs.map((s, i) => {
    const from = stream.indexOf(s.from);
    if (from < 0) throw new Error(`구간 ${i + 1}(${s.name ?? ""}): from 앵커를 찾지 못함: ${s.from}`);
    let to = stream.length;
    if (s.to) { to = stream.indexOf(s.to, from + s.from.length); if (to < 0) throw new Error(`구간 ${i + 1}(${s.name ?? ""}): to 앵커를 찾지 못함: ${s.to}`); }
    return { name: s.name ?? `구간${i + 1}`, from, to, year: s.year ?? startYear, month: s.month, startDay: s.startDay ?? 1, noGanji: Boolean(s.noGanji), ignoreMonthHeader: Boolean(s.ignoreMonthHeader) };
  });
} else {
  regions = [{ name: "전체", from: 0, to: stream.length, year: startYear, month: Number(startMonthArg), startDay, noGanji: allowNoGanji, weather: true }];
}

const entries = [];
const anomalies = [];

function processRegion(rg, ri) {
  const cands = [];
  for (const m of stream.matchAll(HEAD)) {
    if (m.index < rg.from || m.index >= rg.to) continue;
    const gj = m[2] ? m[2] + m[4] : null;
    const c = { pos: m.index, len: m[0].length, tok: m[1], ganji: gj, day: dayNum(m[1]), idx: gj ? gIdx(gj) : -1, rawHead: m[3] ? m[0] : null, region: ri };
    if (Number.isNaN(c.day)) continue;
    if (stream[c.pos - 1] === "(") continue; // 괄호 안의 머리('(十三日甲戌)')는 일기 머리로 보지 않는다
    if (!c.ganji) {
      if (!rg.noGanji) continue; // 일간지가 있는 구간에서는 오탐만 늘리므로 끈다
      const after = stream.slice(c.pos + c.len, c.pos + c.len + 4);
      const before = stream[c.pos - 1];
      if (after[0] === "也" || before === "乃") continue; // '乃初十日也' 같은 문장 속 날짜 언급
      if (rg.weather && !WEATHER.test(after) && before !== "月") continue; // 전체 구간 모드: 날씨 글자/월 머리 필요
    }
    cands.push(c);
  }

  let last = null, month = rg.month, year = rg.year, leap = false;
  for (const c of cands) {
    if (!last && c.day !== rg.startDay) continue; // 구간 앞부분의 가짜 머리 건너뜀: 시작 일자부터 사슬 시작
    // ignoreMonthHeader: 판독문의 월 표기가 일간지와 안 맞는 구간(1책 B)에서는 월 머리를 무시하고 롤오버로만 월을 센다.
    const hmRaw = monthHeader(stream.slice(Math.max(0, c.pos - 12), c.pos));
    const hm = rg.ignoreMonthHeader ? null : hmRaw;
    if (!last) {
      if (hm) { month = hm.month; leap = hm.leap; if (hm.year) year = hm.year; }
    } else {
      // 1차 기준은 날짜 번호. 월 경계: 엄격(직전 ≥27일, 이번 ≤3일) 이거나, 일간지 간격이 '남은 날 + 이번 일자'(달 길이 29/30)와 맞으면 느슨한 경계 인정.
      const dd = c.day - last.day;
      const stepG = c.idx >= 0 && last.idx >= 0 ? (c.idx - last.idx + 60) % 60 : null;
      const strictRoll = last.day >= 27 && c.day <= 3;
      const looseRoll = !strictRoll && last.day >= 18 && c.day <= 5 && stepG !== null && [29, 30].some((L) => L - last.day + c.day === stepG);
      const rollover = strictRoll || looseRoll;
      // 같은 달 안 전진: 기본 +1~+3일, 일간지가 일자 간격과 정확히 맞으면 +12일까지(여러 날이 빠진 경우).
      const forward = (dd >= 1 && dd <= 3) || (dd >= 4 && dd <= 12 && stepG === dd);
      // 일간지 없는 구간에서 '五月二十九日'·'八月二十四日'처럼 월이 명시된 머리는 건너뜀이 커도 인정한다.
      const explicit = rg.noGanji && !c.ganji && hm;
      if (!forward && !rollover && !explicit) {
        if (c.ganji) anomalies.push(`머리로 보기 어려워 제외: ${c.tok}日${c.ganji} @${c.pos} (직전 ${last.day}일, 일자 간격 ${dd})`);
        continue;
      }
      if (rollover) { month += 1; leap = false; }
      if (hm) {
        if (hm.leap) { month = hm.month; leap = true; } // 윤달: 월 번호는 직전 달과 같다
        else if (hm.month !== month) {
          if (!explicit) anomalies.push(`월 머리(${hm.month}月)와 롤오버 추정(${month}월) 불일치 — 머리 기준으로 보정`);
          month = hm.month; leap = false;
        }
        if (hm.year && hm.year !== year) { anomalies.push(`연 표기로 해 전환: ${year} -> ${hm.year}`); year = hm.year; }
      }
      if (month > 12) { month = 1; year += 1; anomalies.push(`월 번호가 12를 넘어 ${year}년으로 전환(연 표기 없음)`); }
      if (c.idx >= 0 && last.idx >= 0 && !rollover && !explicit) {
        if (stepG !== dd) anomalies.push(`일간지 불연속: ${last.day}일 ${last.ganji} -> ${c.day}일 ${c.ganji} (일자 +${dd}, 간지 +${stepG}) — 일기의 간지 오기 또는 판독 오류 후보`);
        else if (dd > 1) anomalies.push(`일기 건너뜀: ${last.day}일 -> ${c.day}일 (${dd - 1}일 미기재)`);
      } else if (!rollover && !explicit && dd > 1) anomalies.push(`일기 건너뜀(간지 없음): ${last.day}일 -> ${c.day}일`);
    }
    const monthNote = rg.ignoreMonthHeader && hmRaw && hmRaw.month !== month ? `판독문 월 머리 '${hmRaw.month}月'은 일간지와 맞지 않아 ${month}월로 배정` : null;
    entries.push({ ...c, month, leap, year, regionEnd: rg.to, regionName: rg.name, monthNote });
    last = c;
  }
}
regions.forEach(processRegion);

const MONTH_TAIL = new RegExp(`(?:${YEAR_RE})?(閏)?([正一二三四五六七八九]|十[一二]?)月(?:[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])?\\s?$`);
entries.forEach((e, i) => {
  const next = entries[i + 1];
  const end = next && next.region === e.region ? next.pos : e.regionEnd;
  // 다음 일기의 월 머리는 본문 끝에 딸려 오므로 떼어 내고, 포털 판독문의 주석 번호('1)' 등)도 제거한다. 【】 세주는 둔다.
  e.text = stream.slice(e.pos + e.len, end).replace(MONTH_TAIL, "").replace(/\d+\)/g, "").replace(/^\s+|\s+$/g, "");
  if (i === entries.length - 1 && tailCut) { const k = e.text.indexOf(tailCut); if (k >= 0) { e.tailCutChars = e.text.length - k; e.text = e.text.slice(0, k).replace(/^\s+|\s+$/g, ""); } }
  e.pageFrom = pageAt[e.pos];
  e.pageTo = pageAt[Math.max(e.pos, end - 1)];
});

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
const volume = { 1: "1책 임진일기", 2: "2책 계사일기", 3: "3책 갑오일기", 4: "4책 병신일기", 5: "5책 정유일기", 6: "6책 속정유일기", 7: "7책 무술일기" }[bookArg] ?? `${bookArg}책`;
const out = entries.filter((e) => e.year === onlyYear);
const skipped = entries.length - out.length;
const noteOf = (e) => [e.monthNote, e.rawHead ? `판독문 머리 표기 '${e.rawHead}' (괄호 글자 포함, 의미 미확인)` : "", segmentsFile ? `구간: ${e.regionName}` : ""].filter(Boolean).join("; ");
const rows = out.map((e) => [e.month, e.day, e.leap ? "1" : "", "", e.ganji ?? "", esc(e.text), "", `국가유산포털 원문텍스트 ${volume} ${e.pageFrom === e.pageTo ? e.pageFrom : `${e.pageFrom}~${e.pageTo}`}쪽`, noteOf(e)].join("\t"));
const header = [
  `# 국가유산포털 원문텍스트(${volume}, ${onlyYear}년분) 자동 분할 결과. 생성: tools/research/build_diary_tsv.mjs`,
  "# 본문은 포털 텍스트 그대로(줄바꿈 제거). 판독 주체와 이용 조건 미확인.",
  "lunar_month\tlunar_day\tleap\tgregorian\tday_ganji\ttext_han\ttext_ko\tsource_ref\tnote",
];
if (outArg) writeFileSync(resolve(outArg), [...header, ...rows].join("\n") + "\n", "utf-8");

const years = [...new Set(entries.map((e) => e.year))].join(", ");
console.log(`책 ${bookArg}: 일기 ${entries.length}일 분할 (시작 ${startYear}년 ${startMonthArg}월, 포함 연도: ${years}${segmentsFile ? `, 구간 ${regions.length}개` : ""})`);
if (entries.length) console.log(`첫: ${entries[0].year}-${entries[0].month}/${entries[0].day} ${entries[0].ganji ?? "(간지없음)"} | 끝: ${entries.at(-1).year}-${entries.at(-1).month}/${entries.at(-1).day} ${entries.at(-1).ganji ?? "(간지없음)"}`);
console.log(`출력(${onlyYear}년): ${out.length}일${skipped ? ` / 다른 해 ${skipped}일은 제외` : ""} | 일간지 없는 머리 ${out.filter((e) => !e.ganji).length}일`);
if (tailCut && entries.at(-1)?.tailCutChars) console.log(`마지막 일기 뒤 비일기 부록 ${entries.at(-1).tailCutChars}자를 '${tailCut}' 위치에서 제외`);
console.log(`이상 징후 ${anomalies.length}건`);
anomalies.forEach((a) => console.log(" -", a));
if (report) entries.forEach((e) => console.log(`${e.year}-${e.leap ? "윤" : ""}${e.month}/${e.day} ${e.ganji ?? "-"} p${e.pageFrom}-${e.pageTo} len=${e.text.length}`));
