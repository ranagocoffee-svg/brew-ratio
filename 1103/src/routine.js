export const DEFAULT_ROUTINE = [
  { id: 'stretch', name: '스트레칭', emoji: '🤸', seconds: 5 * 60 },
  { id: 'massage', name: '손/귀/발 마사지', emoji: '✋', seconds: 5 * 60 },
  { id: 'bong', name: '봉체조', emoji: '🪄', seconds: 5 * 60 },
  { id: 'squat', name: '스쿼트', emoji: '🏋️', seconds: 5 * 60 },
  { id: 'pushup', name: '팔굽혀펴기', emoji: '💪', seconds: 5 * 60 },
  { id: 'breath', name: '호흡/마무리', emoji: '🧘', seconds: 5 * 60 },
];

export function totalSeconds(routine) {
  return routine.reduce((sum, b) => sum + b.seconds, 0);
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
