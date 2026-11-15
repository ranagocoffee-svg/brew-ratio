// Project YI MVP viewer — 정적 JSON(data/sample/nanjung)을 읽어 그린다. 빌드 단계 없음.
const BASE = "/data/sample/nanjung/";
const FILES = ["sources", "editions", "readings", "events", "claims", "diary_entries", "coverage"];
const LAYER = { contemporary: "당대 기록", compiled_later: "후대 편찬", modern_reception: "근대 수용", contemporary_scholarship: "현대 연구", popular: "대중 서사", reference_secondary: "2차 참고", unclassified: "층위 미분류" };
const ORIGIN = { kr: "조선", jp: "일본", cn: "명", west: "서구", intl: "기타" };
const CERT = { verified: "확인됨", unverified: "미검증", disputed: "이의 있음" };
const KIND = { autograph: "친필 초고", copy: "필사본", printed: "간행본", transcription: "탈초본", critical_edition: "교감본" };
const STATUS = { placeholder: "본문 미입력", transcribed: "입력됨", reviewed: "검수됨" };
const COVER = { extant: "현존", missing_in_edition: "판본에서 결락", not_written_or_unknown: "기록 안 됨/불명", to_verify: "확인 필요" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const chip = (kind, text) => `<span class="chip ${kind}">${esc(text)}</span>`;
const certChip = (c) => chip(c, CERT[c] ?? c);

const D = {};
const YEARS = [1596, 1597, 1598];
const DEFAULT_EVENT = { 1596: null, 1597: "ev-1597-myeongnyang", 1598: "ev-1598-joint-assault" };
const state = { tab: "timeline", year: 1597, eventId: DEFAULT_EVENT[1597], month: 9 };

async function load() {
  await Promise.all(FILES.map(async (f) => { D[f] = await (await fetch(`${BASE}${f}.json`, { cache: "no-store" })).json(); }));
  D.byId = Object.fromEntries(Object.values(D).flat().filter((x) => x && x.id).map((x) => [x.id, x]));
}

const lunarText = (o) => (o.month == null ? `${o.year}년` : `${o.year}년 ${o.leap_month ? "윤" : ""}${o.month}월${o.day != null ? ` ${o.day}일` : ""}`);
const dayOfYear = (iso) => (Date.UTC(...iso.split("-").map((n, i) => (i === 1 ? n - 1 : +n))) - Date.UTC(state.year, 0, 1)) / 86400000;
const pct = (iso) => (dayOfYear(iso) / 365) * 100;
const placed = (ev) => ev.date.gregorian?.length === 10 && ev.date.gregorian.startsWith(String(state.year));
/** 사건이 보고 있는 연도에 속하는가. 범위 사건(예: 1594~1598)은 범위 안의 모든 해에 속한다. */
const inYear = (ev, y) => (ev.date.precision === "range" ? ev.date.original.year <= y && y <= ev.date.end_year : Number((ev.date.gregorian ?? String(ev.date.original.year)).slice(0, 4)) === y);
const yearTabs = () => `<div class="years">${YEARS.map((y) => `<button data-year="${y}" aria-pressed="${y === state.year}">${y}년</button>`).join("")}</div>`;

function banner() {
  const all = [...D.events, ...D.diary_entries];
  const n = (c) => all.filter((x) => x.date.certainty === c).length;
  const entries = D.diary_entries.filter((e) => e.text_status !== "placeholder").length;
  document.getElementById("banner").innerHTML =
    `⚠ 이 화면의 연표는 <b>교차검증 문서에서 옮긴 값으로 원문 대조 전</b>입니다. 날짜 상태: 확인됨 ${n("verified")} · 미검증 ${n("unverified")} · 이의 있음 ${n("disputed")} · 일기 본문 입력 ${entries}일`;
}

/* ---------- 연표 ---------- */
function timeline() {
  const Y = state.year;
  const months = Array.from({ length: 12 }, (_, i) => `<span style="left:${(Date.UTC(Y, i, 1) - Date.UTC(Y, 0, 1)) / 86400000 / 365 * 100}%">${i + 1}월</span>`).join("");
  const grid = Array.from({ length: 12 }, (_, i) => `<i class="grid" style="left:${(Date.UTC(Y, i, 1) - Date.UTC(Y, 0, 1)) / 86400000 / 365 * 100}%"></i>`).join("");
  const lane = (track, label) => {
    const evs = D.events.filter((e) => e.track === track && placed(e)).sort((a, b) => pct(a.date.gregorian) - pct(b.date.gregorian));
    // 라벨이 겹치면 단(row)을 쌓고, 오른쪽 끝에서는 오른쪽 정렬해 잘리지 않게 한다. 폭은 글자 수로 어림한 값(%).
    const ends = [];
    const items = evs.map((e) => {
      const p = pct(e.date.gregorian), w = Math.min(40, 4 + e.title_ko.length * 1.9);
      const right = p + w / 2 > 99;
      const [s, t] = right ? [p - w, p] : [p - w / 2, p + w / 2];
      let row = 0;
      while (ends[row] !== undefined && s < ends[row] + 0.5) row++;
      ends[row] = t;
      return { e, p, row, right };
    });
    const rows = Math.max(1, ends.length);
    return `<div class="lane" style="height:${14 + rows * 32}px"><label>${label}</label>${grid}${items.map(({ e, p, row, right }) => `<button class="ev ${track} ${e.date.certainty === "disputed" ? "disputed" : ""}" style="left:${p}%;top:${8 + row * 32}px;${right ? "transform:translateX(-100%)" : ""}" data-ev="${e.id}" aria-pressed="${e.id === state.eventId}" title="${esc(e.title_ko)}">${esc(e.title_ko)}</button>`).join("")}</div>`;
  };
  const unplaced = D.events.filter((e) => inYear(e, Y) && !placed(e));
  const unplacedHtml = unplaced.length
    ? `<h3>양력 날짜 미확정 (월·연 단위)</h3>` + unplaced.map((e) => `<div class="lane" style="margin-left:0;height:44px"><div class="bar"><button data-ev="${e.id}">${esc(e.title_ko)}</button><span>${e.track === "world" ? "세계" : "이순신"} · ${e.date.precision === "range" ? `${e.date.original.year}~${e.date.end_year}` : lunarText(e.date.original)} ${certChip(e.date.certainty)}</span></div></div>`).join("")
    : "";

  const m = state.month;
  const inMonth = D.events.filter((e) => e.date.original.calendar === "lunisolar" && e.date.original.year === Y && e.date.original.month === m);
  const entries = D.diary_entries.filter((e) => e.date.original.year === Y && e.date.original.month === m);
  const monthHtml = `
    <h2>Cross-Time Slider · ${Y}년 음력 ${m}월</h2>
    <div class="slider"><span class="sub">1월</span><input id="month" type="range" min="1" max="12" value="${m}" aria-label="음력 월"><span class="sub">12월</span></div>
    <table><tr><th style="width:90px">구분</th><th>내용</th></tr>
      <tr><td>사건</td><td>${inMonth.length ? inMonth.map((e) => `<a href="#" data-ev="${e.id}">${esc(e.title_ko)}</a> ${certChip(e.date.certainty)}`).join("<br>") : '<span class="empty">이 달에 날짜가 확정된 사건 없음 (≠ 사건이 없었다는 뜻)</span>'}</td></tr>
      <tr><td>난중일기</td><td>${diaryMonthCell(entries)}</td></tr>
      <tr><td>결측</td><td>${D.coverage.filter((c) => c.period.startsWith(String(Y))).map((c) => `${esc(c.period)} · ${esc(D.byId[c.edition_id]?.title)} ${chip("", COVER[c.status])}`).join("<br>") || '<span class="empty">이 해의 결측 기록 없음</span>'}</td></tr>
    </table>`;

  return `<section class="card">${yearTabs()}<h2>${Y}년 연표 (양력)</h2>
    <div class="axis">${months}</div>${lane("yi", "이순신")}${lane("world", "세계")}${unplacedHtml}
    <p class="note">붉은 테두리 = 날짜 이의 있음. 클릭하면 아래에 상세가 열립니다.</p></section>
    <section class="card">${monthHtml}</section>
    <section class="card" id="detail">${detail()}</section>`;
}

const written = (es) => es.filter((e) => e.text_status !== "placeholder");
const checkChip = (e) => {
  const g = e.date.ganji_check;
  return g ? chip("disputed", `간지 불일치 ${g.written}≠${g.expected}`) : e.day_ganji ? chip("verified", `간지 ${e.day_ganji}`) : "";
};

const byVolume = (es) => { const m = new Map(); for (const e of es) { const k = e.volume ?? "(책 구분 없음)"; if (!m.has(k)) m.set(k, []); m.get(k).push(e); } return m; };

function diaryMonthCell(entries) {
  const w = written(entries);
  if (!w.length) return '<span class="empty">입력된 일기 없음 (≠ 일기가 없다는 뜻, "입력되지 않음")</span>';
  return [...byVolume(w)].map(([vol, es]) => {
    const bad = es.filter((e) => e.date.ganji_check).length;
    const rows = es.map((e) => { const o = e.date.original; return `<tr><td style="width:56px">${o.leap_month ? "윤" : ""}${o.month}/${o.day}</td><td style="width:150px">${e.date.gregorian ?? "—"} ${checkChip(e)}</td><td class="note">${esc(e.text_han.slice(0, 46))}…</td></tr>`; }).join("");
    return `<div style="margin-bottom:8px"><b>${esc(vol)} · ${es.length}일 입력</b> ${bad ? chip("disputed", `일간지 불일치 ${bad}일`) : chip("verified", "일간지 전부 일치")}
      <details style="margin-top:4px"><summary>일기 목록 열기</summary><table>${rows}</table></details></div>`;
  }).join("");
}

/** 사건의 음력 날짜에 해당하는 일기를 책별로 나란히 보여준다(5책 vs 6책 대조). */
function diaryFor(ev) {
  const o = ev.date.original;
  if (o.calendar !== "lunisolar" || o.day == null) return "";
  const es = written(D.diary_entries).filter((x) => x.date.original.year === o.year && x.date.original.month === o.month && x.date.original.day === o.day);
  if (!es.length) return "";
  const card = (e) => {
    const g = e.date.ganji_check;
    return `<div style="flex:1 1 320px;min-width:0;border:1px solid var(--line);border-radius:10px;padding:10px 12px">
      <div><b>${esc(e.volume ?? "")}</b> <span class="sub">${esc(e.source_ref)}</span></div>
      <p style="font-family:'Noto Serif KR','Batang',serif;line-height:1.9;margin:6px 0">${esc(e.text_han.slice(0, 170))}…</p>
      <div class="note">${e.text_han.length}자 · 일간지 ${esc(e.day_ganji)} ${g ? chip("disputed", `실제 ${g.expected}와 지지 ${g.branch_shift > 0 ? "+" : ""}${g.branch_shift}`) : chip("verified", "달력과 일치")} · 양력 ${esc(e.date.gregorian)} <span class="sub">(변환기 ${esc(e.date.computed_gregorian ?? "—")})</span></div></div>`;
  };
  return `<h3>일기 본문 발췌 — 책별 대조 <span class="sub">(포털 판독문, 미검수)</span></h3>
    <div style="display:flex;gap:10px;flex-wrap:wrap">${es.map(card).join("")}</div>
    ${es.length > 1 ? `<p class="note">같은 날짜인데 본문이 다릅니다. 6책 속정유일기는 5책의 사본이 아니라 별도로 쓴 기록으로 보이며, 수치 서술이 갈립니다(위 병기 수치 참조).</p>` : ""}`;
}

function detail() {
  const e = D.byId[state.eventId];
  if (!e) return state.eventId ? '<p class="empty">사건을 선택하세요.</p>' : '<p class="empty">이 해에는 아직 정리된 사건이 없습니다. 일기는 위의 음력 월 슬라이더와 「판본 · 일기」 탭에서 볼 수 있습니다.</p>';
  const d = e.date, o = d.original;
  const claims = D.claims.filter((c) => c.event_id === e.id);
  const fields = [...new Set(claims.map((c) => c.field))];
  const FIELD = { japanese_ships: "일본 함선 수", joseon_ships: "조선 함선 수", japanese_ships_destroyed: "격파된 일본 함선 수" };
  const volOf = (c) => (/^([56]책)/.exec(c.note ?? "") ?? [])[1];
  const label = (c) => c.source_ids.map((s) => D.byId[s]?.title.split(":")[0].split("(")[0].trim()).join(", ") + (volOf(c) ? ` · ${volOf(c)}` : "");
  const claimHtml = claims.length
    ? `<h3>출처별로 갈리는 수치 (하나로 합치지 않음)</h3><div class="claims">${fields.map((f) => {
        const rows = claims.filter((c) => c.field === f);
        const max = Math.max(...rows.map((c) => c.value), 1); // 항목별로 막대 길이를 따로 계산
        return `<div class="sub" style="margin-top:6px">${FIELD[f] ?? esc(f)}</div>` + rows.map((c) => `<div class="claimrow"><span>${esc(label(c))}</span><div class="claimbar ${c.status === "disputed" ? "disputed" : ""}" style="width:${Math.max(3, (c.value / max) * 100)}%" title="${esc(c.note)}"></div><span><b>${esc(c.value)}</b></span></div>`).join("");
      }).join("")}</div>`
    : "";
  const srcHtml = e.source_ids.map((s) => { const x = D.byId[s]; return x ? `<tr><td>${esc(x.title)}</td><td>${chip("", LAYER[x.layer])}</td><td>${esc(ORIGIN[x.origin])}</td><td>${chip("", x.reliability === "unrated" ? "신뢰도 미평가" : `등급 ${x.reliability}`)} ${x.status === "candidate_unverified" ? chip("unverified", "서지 미확인") : ""}</td></tr>` : ""; }).join("");
  return `<h2>${esc(e.title_ko)} <span class="sub">${esc(e.title_en ?? "")}</span></h2>
    <dl>
      <dt>트랙</dt><dd>${e.track === "yi" ? "이순신·조선" : "동시대 세계"}</dd>
      <dt>원본 날짜</dt><dd>${o.calendar === "lunisolar" ? "음력 " : ""}${esc(lunarText(o))}${d.precision === "range" ? ` ~ ${d.end_year}` : ""}</dd>
      <dt>양력(사용값)</dt><dd>${esc(d.gregorian ?? "미확정")} ${d.julian ? `<span class="sub">· 율리우스력 ${esc(d.julian)}</span>` : ""}</dd>
      ${d.computed_gregorian ? `<dt>변환기 계산</dt><dd>${esc(d.computed_gregorian)} <span class="sub">${esc(d.converter)}</span></dd>` : ""}
      <dt>날짜 확실도</dt><dd>${certChip(d.certainty)} ${e.verified ? chip("verified", "사건 검증됨") : chip("unverified", "사건 미검증")}</dd>
      <dt>날짜 메모</dt><dd class="note">${esc(d.note ?? "—")}</dd>
      ${e.note ? `<dt>메모</dt><dd class="note">${esc(e.note)}</dd>` : ""}
    </dl>
    ${claimHtml}
    ${diaryFor(e)}
    <h3>출처</h3><table><tr><th>출처</th><th>층위</th><th>국가</th><th>상태</th></tr>${srcHtml}</table>
    ${d.certainty === "disputed" ? `<p class="note">📎 조사: docs/investigations/myeongnyang-date.md — 일기 9/16 일간지 甲辰=10/26, 癸卯=10/25 로 확정할 수 있습니다.</p>` : ""}`;
}

/* ---------- 사료 ---------- */
function sources() {
  const order = Object.keys(LAYER);
  return `<section class="card"><h2>사료를 층위별로 분리</h2>
    <p class="note">당대 기록·후대 편찬·근대 수용·현대 연구·대중 서사를 섞지 않고 신뢰도와 서지 확인 상태를 함께 표시합니다.</p>
    ${order.map((l) => { const rows = D.sources.filter((s) => s.layer === l); return rows.length ? `<h3>${LAYER[l]} (${rows.length})</h3><table><tr><th>제목</th><th>국가</th><th>신뢰도</th><th>상태</th></tr>${rows.map((s) => `<tr><td>${esc(s.title)}${s.note ? `<div class="note">${esc(s.note)}</div>` : ""}</td><td>${esc(ORIGIN[s.origin])}</td><td>${s.reliability === "unrated" ? "미평가" : esc(s.reliability)}</td><td>${s.status === "confirmed" ? chip("verified", "서지 확인") : chip("unverified", "서지 미확인")}</td></tr>`).join("")}</table>` : ""; }).join("")}</section>`;
}

/* ---------- 판본 · 일기 ---------- */
function editions() {
  const li = (ed) => `<li><b>${esc(ed.title)}</b> ${chip("", KIND[ed.kind])} ${ed.is_base ? chip("verified", "기준 판본") : ""}
      <div class="note">${esc(ed.note ?? "")}</div>
      ${ed.derived_from.length ? `<div class="note">← ${ed.derived_from.map((p) => esc(D.byId[p]?.title.split("(")[0].trim())).join(", ")}</div>` : ""}
      ${D.readings.filter((r) => r.edition_id === ed.id).map((r) => `<div class="note">판독: ${esc(r.reader)}${r.year ? ` (${r.year})` : ""}${r.note ? ` — ${esc(r.note)}` : ""}</div>`).join("")}</li>`;
  return `<section class="card"><h2>난중일기 판본 계보</h2>
    <p class="note">친필 초고 → 필사·간행·탈초 → 교감본. 번역은 표시용이며 분석은 한문 판독본에서 합니다.</p>
    <ul class="tree">${D.editions.map(li).join("")}</ul></section>
    <section class="card"><h2>1596~1598년 일기 입력 현황</h2>
    ${monthSummary()}
    <p class="note">초고본 4책~7책 본문은 국가유산포털 원문텍스트(판독 주체·이용 조건 미확인, 미검수). 기준 판본(교감본) 본문은 아직 비어 있습니다(placeholder). 가져오기: <code>tools/research/fetch_heritage_text.mjs</code> → <code>build_diary_tsv.mjs</code> → <code>import_diary.mjs</code></p>
    <h3>결측 기록</h3><table><tr><th>기간</th><th>판본</th><th>상태</th><th>메모</th></tr>${D.coverage.map((c) => `<tr><td>${esc(c.period)}</td><td>${esc(D.byId[c.edition_id]?.title)}</td><td>${chip("", COVER[c.status])}</td><td class="note">${esc(c.note)}</td></tr>`).join("")}</table></section>`;
}

const NOTE = {
  "4책 병신일기": "1/1~10/11 305일(윤8월 포함) 일간지가 전부 달력·변환기와 일치. 일기가 없는 날은 6/24, 윤8/24뿐. 9/12·9/14·9/15의 '女眞' 표기는 판독 쟁점 후보(결측 기록 참조).",
  "5책 정유일기": "4~6월은 전부 일치. 7/4~10/3은 천간은 맞고 지지가 일관되게 +2(일기 자체의 간지 오기 가능성, 가설).",
  "6책 속정유일기": "일간지가 처음부터 끝까지 달력과 일치. 1597 9월 29일은 변환기보다 +1일(변환기 표 오류), 8/30은 변환기에 없는 날(변환기는 8월을 29일로 봄). 1598 정월 1~4일은 변환기와 일치.",
  "7책 무술일기": "9/15~10/7 23일, 일간지가 연속·일치하고 변환기와도 일치. 책 앞부분의 명 장수 선물 목록과 10/7 항목 끝의 명 보고문·선박 수 목록은 일기 본문이 아님(결측 기록 참조).",
};

function monthSummary() {
  const w = written(D.diary_entries);
  return [...byVolume(w)].map(([vol, all]) => {
    const ym = (e) => e.date.original.year * 10000 + e.date.original.month * 100 + (e.date.original.leap_month ? 50 : 0);
    const months = [...new Set(all.map(ym))].sort((a, b) => a - b);
    const rows = months.map((key) => {
      const yr = Math.floor(key / 10000), m = Math.floor((key % 10000) / 100), lp = key % 100 === 50;
      const es = all.filter((e) => ym(e) === key);
      const bad = es.filter((e) => e.date.ganji_check);
      const shifts = [...new Set(bad.map((e) => e.date.ganji_check.branch_shift))].map((s) => (s > 0 ? "+" : "") + s).join(", ");
      const adj = es.filter((e) => e.date.computed_gregorian && e.date.gregorian !== e.date.computed_gregorian).length;
      const noConv = es.filter((e) => !e.date.computed_gregorian).length;
      return `<tr><td>${yr}년 음력 ${lp ? "윤" : ""}${m}월</td><td>${es.length}일</td><td>${es.length - bad.length}</td><td>${bad.length ? `${chip("disputed", `${bad.length}일`)} 지지 ${shifts}, 천간 불일치 ${bad.filter((e) => !e.date.ganji_check.stem_match).length}` : "—"}</td><td>${adj ? `${chip("disputed", `${adj}일`)} 변환기보다 +1일` : "—"}${noConv ? ` ${chip("unverified", `${noConv}일 변환기에 없음`)}` : ""}</td></tr>`;
    }).join("");
    return `<h3>${esc(vol)} · ${all.length}일</h3><table><tr><th>월</th><th>입력</th><th>간지 일치</th><th>간지 불일치</th><th>양력 조정(변환기 대비)</th></tr>${rows}</table>
      <p class="note">${esc(NOTE[vol] ?? "")}</p>`;
  }).join("");
}

function render() {
  document.querySelectorAll("nav button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  document.getElementById("app").innerHTML = { timeline, sources, editions }[state.tab]();
}

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-tab],[data-ev],[data-year]");
  if (!t) return;
  ev.preventDefault();
  if (t.dataset.year) { state.year = Number(t.dataset.year); state.eventId = DEFAULT_EVENT[state.year]; state.month = 9; state.tab = "timeline"; }
  if (t.dataset.tab) state.tab = t.dataset.tab;
  if (t.dataset.ev) { state.eventId = t.dataset.ev; state.tab = "timeline"; }
  render();
  if (t.dataset.ev) document.getElementById("detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
});
document.addEventListener("input", (ev) => {
  if (ev.target.id === "month") { state.month = Number(ev.target.value); render(); document.getElementById("month")?.focus(); }
});

load().then(() => { banner(); render(); }).catch((e) => { document.getElementById("app").innerHTML = `<p class="empty">데이터 로드 실패: ${esc(e.message)}. 서버로 열어야 합니다: node tools/serve.mjs</p>`; });
