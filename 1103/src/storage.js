const STORAGE_KEY = 'morning-routine:checkins';

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function readCheckins() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCheckins(checkins) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checkins));
  } catch {
    // localStorage unavailable (private mode, quota, etc.) - ignore
  }
}

export function isDoneToday() {
  return readCheckins().includes(todayKey());
}

export function markDoneToday() {
  const checkins = readCheckins();
  const key = todayKey();
  if (!checkins.includes(key)) {
    checkins.push(key);
    writeCheckins(checkins);
  }
}

export function getCheckinSet() {
  return new Set(readCheckins());
}

export function getStreak() {
  const set = getCheckinSet();
  let streak = 0;
  const cursor = new Date();
  if (!set.has(todayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(todayKey(cursor))) return 0;
  }
  while (set.has(todayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function getTotalCompletions() {
  return readCheckins().length;
}

export { todayKey };
