import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../routine.js';
import { playBeep } from '../beep.js';

export default function RoutinePlayer({ routine, onComplete, onExit }) {
  const [blockIndex, setBlockIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(routine[0].seconds);
  const [isPaused, setIsPaused] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const intervalRef = useRef(null);

  const currentBlock = routine[blockIndex];

  useEffect(() => {
    if (isPaused || isFinished) return;
    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          goToNextBlock();
          return prev;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused, isFinished, blockIndex]);

  function goToNextBlock() {
    playBeep();
    setBlockIndex((prevIndex) => {
      const nextIndex = prevIndex + 1;
      if (nextIndex >= routine.length) {
        setIsFinished(true);
        clearInterval(intervalRef.current);
        onComplete();
        return prevIndex;
      }
      setSecondsLeft(routine[nextIndex].seconds);
      return nextIndex;
    });
  }

  function handleSkip() {
    clearInterval(intervalRef.current);
    goToNextBlock();
  }

  if (isFinished) {
    return (
      <div className="player finished">
        <div className="finished-emoji">🎉</div>
        <h2>오늘 루틴 완료!</h2>
        <p>30분 모닝 루틴을 모두 마쳤어요. 잘하셨어요!</p>
        <button className="btn primary" onClick={onExit}>
          홈으로
        </button>
      </div>
    );
  }

  return (
    <div className="player">
      <div className="block-dots">
        {routine.map((b, i) => (
          <div
            key={b.id}
            className={
              'dot' +
              (i < blockIndex ? ' done' : '') +
              (i === blockIndex ? ' current' : '')
            }
            title={b.name}
          >
            {b.emoji}
          </div>
        ))}
      </div>

      <div className="current-block">
        <div className="current-emoji">{currentBlock.emoji}</div>
        <div className="current-name">{currentBlock.name}</div>
        <div className="current-time">{formatTime(secondsLeft)}</div>
        <div className="step-label">
          {blockIndex + 1} / {routine.length} 단계
        </div>
      </div>

      <div className="player-controls">
        <button className="btn" onClick={() => setIsPaused((p) => !p)}>
          {isPaused ? '▶ 계속' : '⏸ 일시정지'}
        </button>
        <button className="btn" onClick={handleSkip}>
          ⏭ 다음
        </button>
        <button className="btn ghost" onClick={onExit}>
          종료
        </button>
      </div>
    </div>
  );
}
