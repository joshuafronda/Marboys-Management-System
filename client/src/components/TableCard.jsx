import { useState, useEffect, useRef } from 'react';

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatCost(seconds) {
  const cost = (seconds / 3600) * 200;
  return cost.toFixed(2);
}

function formatStartTime(startTime) {
  if (!startTime) return null;
  const d = new Date(startTime);
  return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

export default function TableCard({ table, onClick }) {
  const [elapsed, setElapsed] = useState(table.elapsed_seconds || 0);
  const intervalRef = useRef(null);

  useEffect(() => {
    setElapsed(table.elapsed_seconds || 0);
  }, [table.elapsed_seconds, table.status]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (table.status === 'running') {
      const maxSeconds = table.set_hours > 0 ? Math.round(table.set_hours * 3600) : Infinity;
      intervalRef.current = setInterval(() => {
        setElapsed(prev => {
          if (prev >= maxSeconds) return prev; // stop at set_hours
          return prev + 1;
        });
      }, 1000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [table.status, table.start_time, table.set_hours]);

  const isAvailable = table.status === 'available';
  const isRunning = table.status === 'running';
  const isPaused = table.status === 'paused';
  const isFinished = table.status === 'finished';
  const isExhibition = table.status === 'exhibition';
  const isActive = isRunning || isPaused || isFinished || isExhibition;

  const isExpired = isRunning && table.set_hours > 0 && elapsed >= (table.set_hours * 3600);
  const remaining = isRunning && table.set_hours > 0 ? Math.max(0, Math.round(table.set_hours * 3600 - elapsed)) : 0;
  const hasSetHours = table.set_hours > 0;
  const displayCost = hasSetHours && isRunning
    ? (Math.min(elapsed, table.set_hours * 3600) / 3600 * 200).toFixed(2)
    : formatCost(elapsed);

  const statusBadge = {
    available: <span className="badge-available">Available</span>,
    running: <span className="badge-running">● Running</span>,
    paused: <span className="badge-paused">⏸ Paused</span>,
    finished: <span className="badge-finished">✓ Finished</span>,
    exhibition: <span className="badge-exhibition">Exhibition</span>,
  }[table.status];

  return (
    <div
      className={`card p-4 flex flex-col gap-3 transition-all duration-200 cursor-pointer hover:border-gray-500 ${
        isExpired ? 'border-red-500 animate-pulse' : isRunning ? 'border-gray-500' : isFinished ? 'border-gray-700' : ''
      }`}
      onClick={() => onClick(table)}
    >
      {/* Table header */}
      <div className="flex items-center justify-between">
        <h3 className="text-white font-black text-lg">Table {table.table_number}</h3>
        {statusBadge}
      </div>

      {/* Timer display */}
      <div className={`rounded-lg p-3 text-center font-mono ${
        isExpired ? 'bg-red-600 text-white' :
        isRunning ? 'bg-white text-black' :
        isPaused ? 'bg-gray-900 text-gray-400' :
        isFinished ? 'bg-gray-900 text-gray-300' :
        isExhibition ? 'bg-white text-black border border-gray-300' :
        'bg-gray-950 text-gray-700'
      }`}>
        <div className="text-2xl font-black tracking-widest">
          {isActive ? (hasSetHours && isRunning ? formatTime(remaining) : formatTime(elapsed)) : '00:00:00'}
        </div>
        {isActive && (
          <div className="text-xs mt-1 font-semibold">
            {isExpired ? "TIME'S UP!" : `₱${displayCost}`}
          </div>
        )}
        {isExhibition && (
          <div className="text-xs mt-1 font-semibold text-gray-600">
            Bet: ₱{table.exhibition_bet?.toLocaleString('en-PH') || 0}
          </div>
        )}
        {isRunning && hasSetHours && !isExpired && (
          <div className="text-xs mt-1 opacity-70">
            Elapsed: {formatTime(elapsed)}
          </div>
        )}
      </div>

      {/* Start time */}
      {isActive && table.start_time && (
        <p className="text-xs text-gray-500 text-center">Started: {formatStartTime(table.start_time)}</p>
      )}

      {/* Available hint */}
      {isAvailable && (
        <p className="text-xs text-gray-600 text-center">Click to start</p>
      )}
      
      {/* Exhibition hint */}
      {isExhibition && (
        <p className="text-xs text-gray-500 text-center">Click to pay</p>
      )}
    </div>
  );
}
