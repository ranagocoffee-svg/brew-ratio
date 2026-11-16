import { useMemo, useState } from 'react';
import './App.css';
import { DEFAULT_ROUTINE, totalSeconds, formatTime } from './routine.js';
import { isDoneToday, markDoneToday, getCheckinSet, getStreak, getTotalCompletions } from './storage.js';
import RoutinePlayer from './components/RoutinePlayer.jsx';
import ProgressCalendar from './components/ProgressCalendar.jsx';

function App() {
  const [tab, setTab] = useState('routine');
  const [isPlaying, setIsPlaying] = useState(false);
  const [doneToday, setDoneToday] = useState(isDoneToday());
  const [refreshKey, setRefreshKey] = useState(0);

  const checkinSet = useMemo(() => getCheckinSet(), [refreshKey]);
  const streak = useMemo(() => getStreak(), [refreshKey]);
  const totalCompletions = useMemo(() => getTotalCompletions(), [refreshKey]);

  function handleComplete() {
    markDoneToday();
    setDoneToday(true);
    setRefreshKey((k) => k + 1);
  }

  function handleExitPlayer() {
    setIsPlaying(false);
  }

  const todayLabel = new Date().toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return (
    <div className="app">
      <header className="app-header">
        <h1>모닝 루틴 30</h1>
        <div className="streak-badge">🔥 {streak}일 연속</div>
      </header>

      <nav className="tabs">
        <button
          className={'tab' + (tab === 'routine' ? ' active' : '')}
          onClick={() => setTab('routine')}
        >
          오늘의 루틴
        </button>
        <button
          className={'tab' + (tab === 'history' ? ' active' : '')}
          onClick={() => setTab('history')}
        >
          기록
        </button>
      </nav>

      <main className="app-main">
        {tab === 'routine' && !isPlaying && (
          <div className="home">
            <p className="today-label">{todayLabel}</p>

            {doneToday ? (
              <div className="done-banner">오늘 루틴 완료! 🎉</div>
            ) : null}

            <ul className="block-list">
              {DEFAULT_ROUTINE.map((b) => (
                <li key={b.id} className="block-list-item">
                  <span className="block-emoji">{b.emoji}</span>
                  <span className="block-name">{b.name}</span>
                  <span className="block-duration">{Math.round(b.seconds / 60)}분</span>
                </li>
              ))}
            </ul>
            <p className="total-time">
              총 소요 시간: {formatTime(totalSeconds(DEFAULT_ROUTINE))}
            </p>

            <button className="btn primary big" onClick={() => setIsPlaying(true)}>
              {doneToday ? '다시 시작하기' : '루틴 시작하기'}
            </button>
          </div>
        )}

        {tab === 'routine' && isPlaying && (
          <RoutinePlayer
            routine={DEFAULT_ROUTINE}
            onComplete={handleComplete}
            onExit={handleExitPlayer}
          />
        )}

        {tab === 'history' && (
          <ProgressCalendar
            checkinSet={checkinSet}
            streak={streak}
            totalCompletions={totalCompletions}
          />
        )}
      </main>
    </div>
  );
}

export default App;
