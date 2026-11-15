// 음력 -> 양력(그레고리력)/율리우스력 변환 래퍼.
// 한계: korean-lunar-calendar 는 현대 천문·역법 기준 표다. 16세기 조선이 쓰던 역법과
// 월 경계가 하루 어긋날 수 있으므로 결과는 '계산값'이며 사료 날짜를 덮어쓰지 않는다.
import KoreanLunarCalendar from "korean-lunar-calendar";

export const CONVERTER = "korean-lunar-calendar@0.4.0";
const pad = (n) => String(n).padStart(2, "0");
const dayMs = 86400000;

/** 일 단위 그레고리력(ISO) -> 율리우스력. 1582-10-15 ~ 1700-02-28 구간은 -10일. */
export function gregorianToJulian(g) {
  const d = new Date(`${g}T00:00:00Z`);
  if (d < new Date("1582-10-15T00:00:00Z") || d >= new Date("1700-03-01T00:00:00Z")) throw new Error("지원 범위 밖");
  return new Date(d.getTime() - 10 * dayMs).toISOString().slice(0, 10);
}

/** 음력 -> { gregorian, julian } 또는 null(표에 없는 날짜/범위 밖). */
export function lunarToGregorian(year, month, day, leap = false) {
  const cal = new KoreanLunarCalendar();
  let ok = false;
  try { ok = cal.setLunarDate(year, month, day, !!leap); } catch { ok = false; }
  if (!ok) return null;
  const s = cal.getSolarCalendar();
  const gregorian = `${s.year}-${pad(s.month)}-${pad(s.day)}`;
  let julian = null;
  try { julian = gregorianToJulian(gregorian); } catch { /* 지원 범위 밖 */ }
  return { gregorian, julian };
}

/** 양력 -> 음력 { year, month, day, leap } 또는 null. */
export function gregorianToLunar(gregorian) {
  const [y, m, d] = gregorian.split("-").map(Number);
  const cal = new KoreanLunarCalendar();
  let ok = false;
  try { ok = cal.setSolarDate(y, m, d); } catch { ok = false; }
  if (!ok) return null;
  const l = cal.getLunarCalendar();
  return { year: l.year, month: l.month, day: l.day, leap: !!l.intercalation };
}
