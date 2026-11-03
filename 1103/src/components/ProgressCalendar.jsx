import { todayKey } from '../storage.js';

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function buildLastDays(count) {
  const days = [];
  const cursor = new Date();
  for (let i = 0; i < count; i += 1) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return days.reverse();
}

export default function ProgressCalendar({ checkinSet, streak, totalCompletions }) {
  const days = buildLastDays(35);
  const todayStr = todayKey();

  return (
    <div className="calendar">
      <div className="calendar-stats">
        <div className="stat">
          <div className="stat-value">{streak}</div>
          <div className="stat-label">연속일</div>
        </div>
        <div className="stat">
          <div className="stat-value">{totalCompletions}</div>
          <div className="stat-label">총 완료 횟수</div>
        </div>
      </div>

      <div className="calendar-weekday-row">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="weekday-label">
            {label}
          </div>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((date) => {
          const key = todayKey(date);
          const done = checkinSet.has(key);
          const isToday = key === todayStr;
          return (
            <div
              key={key}
              className={'day-cell' + (done ? ' done' : '') + (isToday ? ' today' : '')}
              title={key}
            >
              {date.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
