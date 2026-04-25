import { useState, useEffect, useRef } from 'react';

// Function to create pleasant chime sound for finished tables
function createRingingSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    let isPlaying = true;
    let timeoutId = null;

    // Play 3 gentle chimes (3 seconds total)
    let chimeCount = 0;
    const maxChimes = 3;

    const playChime = () => {
      if (!isPlaying || chimeCount >= maxChimes) return;
      chimeCount++;

      const now = audioContext.currentTime;

      // Create oscillator for chime
      const osc = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      osc.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Pleasant chime: sine wave, medium pitch
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5 note
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.2); // G5

      // Gentle envelope
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.3, now + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.8);

      osc.start(now);
      osc.stop(now + 0.8);

      // Schedule next chime after 1 second
      if (chimeCount < maxChimes) {
        timeoutId = setTimeout(playChime, 1000);
      }
    };

    // Start chimes
    playChime();

    // Return stop function
    return {
      stop: () => {
        isPlaying = false;
        if (timeoutId) clearTimeout(timeoutId);
        try {
          audioContext.close();
        } catch (e) { }
      }
    };
  } catch (err) {
    console.error('Failed to create chime sound:', err);
    return { stop: () => { } };
  }
}

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

export default function TableCard({ table, onClick, onCctv }) {
  const [elapsed, setElapsed] = useState(table.elapsed_seconds || 0);
  const intervalRef = useRef(null);
  const soundRef = useRef(null);
  const isExpiredRef = useRef(false);

  useEffect(() => {
    setElapsed(table.elapsed_seconds || 0);
  }, [table.elapsed_seconds, table.status]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (table.status === 'running' && table.start_time) {
      const maxSeconds = table.set_hours > 0 ? Math.round(table.set_hours * 3600) : Infinity;
      const base = table.accumulated_seconds || 0;
      const startMs = new Date(table.start_time).getTime();

      const tick = () => {
        const raw = base + Math.floor((Date.now() - startMs) / 1000);
        setElapsed(Math.min(raw, maxSeconds));
      };

      tick(); // immediate update
      intervalRef.current = setInterval(tick, 1000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [table.status, table.start_time, table.set_hours, table.accumulated_seconds]);

  const isAvailable = table.status === 'available';
  const isRunning = table.status === 'running';
  const isPaused = table.status === 'paused';
  const isFinished = table.status === 'finished';
  const isExhibition = table.status === 'exhibition';
  const isActive = isRunning || isPaused || isFinished || isExhibition;

  const isExpired = isRunning && table.set_hours > 0 && elapsed >= (table.set_hours * 3600);
  const shouldRing = isExpired || isFinished;

  // Play continuous ringing when table is expired or finished
  useEffect(() => {
    if (shouldRing && !soundRef.current) {
      // Start ringing
      soundRef.current = createRingingSound();
    } else if (!shouldRing && soundRef.current) {
      // Stop ringing
      soundRef.current.stop();
      soundRef.current = null;
    }

    return () => {
      if (soundRef.current) {
        soundRef.current.stop();
        soundRef.current = null;
      }
    };
  }, [shouldRing]);

  // Track expired state for other logic
  useEffect(() => {
    isExpiredRef.current = isExpired;
  }, [isExpired]);
  const remaining = isRunning && table.set_hours > 0 ? Math.max(0, Math.round(table.set_hours * 3600 - elapsed)) : 0;
  const hasSetHours = table.set_hours > 0;
  const displayCost = hasSetHours && isRunning
    ? (Math.min(elapsed, table.set_hours * 3600) / 3600 * 200).toFixed(2)
    : formatCost(elapsed);

  const statusBadge = {
    available: <span className="badge-available">Available</span>,
    running: <span className="badge-running">● Running</span>,
    paused: <span className="badge-paused">⏸ Paused</span>,
    finished: <span className="bg-white text-red-400 border border-red-200 px-2 py-1 rounded-full text-xs font-bold">FINISHED</span>,
    exhibition: <span className="badge-exhibition">Exhibition</span>,
  }[table.status];



  return (
    <div
      className={`card p-3 sm:p-4 flex flex-col gap-2 sm:gap-3 transition-all duration-200 cursor-pointer hover:border-gray-500 ${isExpired ? 'border-red-500 animate-pulse'
        : isRunning ? 'border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)] animate-pulse-green'
          : isFinished ? 'border-red-400 shadow-[0_0_30px_rgba(248,113,113,0.8),0_0_60px_rgba(239,68,68,0.5)] ring-4 ring-red-400 animate-pulse-light'
            : ''
        }`}
      onClick={() => {
        // Stop ringing when clicked
        if (soundRef.current) {
          soundRef.current.stop();
          soundRef.current = null;
        }
        onClick(table);
      }}
    >
      {/* Table header */}
      <div className="flex items-center justify-between">
        <h3 className="text-white font-black text-sm sm:text-base md:text-lg">Table {table.table_number}</h3>
        <div className="flex items-center gap-1 sm:gap-2">
          {statusBadge}
          {/* CCTV Button */}
          <button
            title="View CCTV"
            className="ml-1 p-1 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 transition-all text-gray-400 hover:text-white flex items-center justify-center"
            onClick={e => { e.stopPropagation(); onCctv && onCctv(table); }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Timer display */}
      <div className={`rounded-lg p-1.5 sm:p-3 text-center font-mono ${isExpired ? 'bg-red-600 text-white' :
        isRunning ? 'bg-white text-black' :
          isPaused ? 'bg-gray-900 text-gray-400' :
            isFinished ? 'bg-gray-900 text-gray-300' :
              isExhibition ? 'bg-white text-black border border-gray-300' :
                'bg-gray-950 text-gray-700'
        }`}>
        <div className="text-lg sm:text-xl md:text-2xl font-black tracking-wider sm:tracking-widest">
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
        <p className="text-[10px] sm:text-xs text-gray-600 text-center">Click to start</p>
      )}

      {/* Exhibition hint */}
      {isExhibition && (
        <p className="text-xs text-gray-500 text-center">Click to pay</p>
      )}

      {/* Finished - urgent notice */}
      {isFinished && (
        <p className="text-[10px] sm:text-xs font-bold text-red-400 text-center animate-bounce">
          TIME'S UP - PAY
        </p>
      )}
    </div>
  );
}
