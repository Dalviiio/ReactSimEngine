import type { ReplayPlayerApi } from '../state/useReplayPlayer';
import type { ReplayRoundIndexEntry } from '../types';

interface RoundSelectorProps {
  rounds: ReplayRoundIndexEntry[];
  player: ReplayPlayerApi;
}

export function RoundSelector({ rounds, player }: RoundSelectorProps) {
  return (
    <aside className="w-56 overflow-y-auto border-r border-slate-700 bg-slate-800 text-sm">
      <h2 className="border-b border-slate-700 p-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Rounds</h2>
      <ul>
        {rounds.map((r) => {
          const isCurrent = player.currentRoundNumber === r.roundNumber;
          return (
            <li key={r.roundNumber}>
              <button
                type="button"
                onClick={() => player.seekToRound(r.roundNumber)}
                className={`flex w-full flex-col items-start gap-0.5 border-b border-slate-700/50 px-3 py-2 text-left hover:bg-slate-700 ${isCurrent ? 'bg-slate-700' : ''}`}
              >
                <span className="font-medium">
                  Round {r.roundNumber} {r.history?.segment === 'overtime' ? '(OT)' : ''}
                </span>
                {r.history ? (
                  <span className="text-xs text-slate-400">
                    {r.history.winner} — {r.history.reason}
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">(en cours)</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
