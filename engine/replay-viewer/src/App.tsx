import { useMemo, useState } from 'react';
import { LoadReplayBar } from './components/LoadReplayBar';
import { PlaybackControls } from './components/PlaybackControls';
import { ReplayCanvas } from './components/ReplayCanvas';
import { RoundSelector } from './components/RoundSelector';
import { SidePanel } from './components/SidePanel';
import { useReplayPlayer } from './state/useReplayPlayer';
import type { MatchReplay } from './types';

export default function App() {
  const [replay, setReplay] = useState<MatchReplay | null>(null);
  const player = useReplayPlayer(replay);

  const teamOrder = useMemo(() => (replay ? [replay.matchState.teamA.name, replay.matchState.teamB.name] : []), [replay]);

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      <header className="border-b border-slate-700 bg-slate-800 px-4 py-2">
        <h1 className="text-base font-semibold">Replay Viewer — ReactSimEngine</h1>
        <p className="text-xs text-slate-400">Lecteur pur d'un fichier MatchReplay (aucune simulation en direct, aucune base de données).</p>
      </header>

      <LoadReplayBar replay={replay} onLoaded={setReplay} />

      {!replay ? (
        <div className="flex flex-1 items-center justify-center text-slate-500">
          Charge un fichier <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5">MatchReplay.json</code> pour commencer
          (voir <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5">sample-replay.json</code> généré par{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5">npm run engine:replay-record-test</code>).
        </div>
      ) : (
        <>
          <div className="flex flex-1 overflow-hidden">
            <RoundSelector rounds={replay.roundIndex} player={player} />
            <ReplayCanvas mapData={replay.mapData} mapImageDataUrl={replay.mapImageDataUrl} player={player} teamOrder={teamOrder} />
            <SidePanel matchState={replay.matchState} player={player} teamOrder={teamOrder} />
          </div>
          <PlaybackControls player={player} tickRate={replay.tickRate} teamOrder={teamOrder} />
        </>
      )}
    </div>
  );
}
