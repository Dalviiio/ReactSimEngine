import type { ReplayPlayerApi } from '../state/useReplayPlayer';

interface PlaybackControlsProps {
  player: ReplayPlayerApi;
  tickRate: number;
  teamOrder: string[];
}

const SPEEDS = [1, 2, 4];

function formatSeconds(tick: number, tickRate: number): string {
  const totalSeconds = Math.floor(tick / tickRate);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PlaybackControls({ player, tickRate, teamOrder }: PlaybackControlsProps) {
  return (
    <div className="flex flex-col gap-2 border-t border-slate-700 bg-slate-800 px-4 py-2">
      <input
        type="range"
        min={player.minTick}
        max={player.maxTick}
        value={player.currentTick}
        onChange={(e) => player.seek(Number(e.target.value))}
        className="w-full accent-sky-500"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => player.stepBy(-1)}
          className="rounded bg-slate-700 px-2 py-1 text-sm hover:bg-slate-600"
          title="Reculer d'un tick"
        >
          ⏮ tick
        </button>
        <button
          type="button"
          onClick={player.togglePlay}
          className="rounded bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-500"
        >
          {player.isPlaying ? '⏸ Pause' : '▶ Lecture'}
        </button>
        <button
          type="button"
          onClick={() => player.stepBy(1)}
          className="rounded bg-slate-700 px-2 py-1 text-sm hover:bg-slate-600"
          title="Avancer d'un tick"
        >
          tick ⏭
        </button>

        <div className="ml-2 flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => player.setSpeed(s)}
              className={`rounded px-2 py-1 text-xs font-medium ${player.speed === s ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              x{s}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs text-slate-300">
          <span>
            Tick {player.currentTick} / {player.maxTick}
          </span>
          <span>{formatSeconds(player.currentTick, tickRate)}</span>

          <label className="flex items-center gap-1">
            Vue :
            <select
              value={player.perspective}
              onChange={(e) => player.setPerspective(e.target.value)}
              className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-xs"
            >
              <option value="observer">Observateur (tout voir)</option>
              {teamOrder.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
