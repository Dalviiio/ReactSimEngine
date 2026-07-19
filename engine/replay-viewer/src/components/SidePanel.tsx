import { TEAM_COLORS } from '../constants';
import type { ReplayPlayerApi } from '../state/useReplayPlayer';
import type { FullMatchState, SimulationEvent } from '../types';

interface SidePanelProps {
  matchState: FullMatchState;
  player: ReplayPlayerApi;
  teamOrder: string[];
}

const SEGMENT_LABELS: Record<ReplayPlayerApi['matchSegment'], string> = {
  regulation: 'Temps réglementaire',
  halftime: 'Mi-temps',
  overtime: 'Overtime',
  finished: 'Terminé',
};

const ROUND_PHASE_LABELS: Record<ReplayPlayerApi['roundPhase'], string> = {
  buy: 'Achat',
  active: 'Active',
  ended: 'Terminé',
};

function describeEvent(event: SimulationEvent): string {
  const d = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'player:killed':
      return `☠ ${d.killerId} élimine ${d.victimId}${d.hitZone === 'head' ? ' (headshot)' : ''}`;
    case 'ability:activated':
      return `✨ ${d.entityId} active ${d.abilityId}`;
    case 'device:planted':
      return `💣 ${d.entityId} pose la charge`;
    case 'device:defusing':
      return `🔧 ${d.entityId} démarre le désamorçage`;
    case 'device:defused':
      return `✅ Charge désamorcée`;
    case 'device:detonated':
      return `💥 Charge explosée`;
    case 'round:started':
      return `— Round ${d.roundNumber} —`;
    case 'round:ended':
      return `Round terminé : ${d.winner} gagne (${d.reason})`;
    case 'match:halftime':
      return `⏱ Mi-temps — ${d.newAttacker} attaque désormais`;
    case 'match:overtime-started':
      return `⏱ Overtime !`;
    case 'match:finished':
      return `🏆 Match terminé — ${d.winner} gagne`;
    default:
      return event.type;
  }
}

export function SidePanel({ matchState, player, teamOrder }: SidePanelProps) {
  return (
    <aside className="flex w-72 flex-col overflow-y-auto border-l border-slate-700 bg-slate-800 text-sm">
      <div className="border-b border-slate-700 p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Score</h2>
        <div className="flex items-center justify-between">
          {teamOrder.map((team, i) => (
            <div key={team} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TEAM_COLORS[i] }} />
              <span className="font-medium">{team}</span>
              <span className="text-lg font-bold">{team === matchState.teamA.name ? matchState.teamA.roundsWon : matchState.teamB.roundsWon}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-slate-700 p-3">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Round</h2>
        <div>Round {player.currentRoundNumber ?? '—'}</div>
        <div className="text-slate-300">
          Phase : <span className="font-medium">{ROUND_PHASE_LABELS[player.roundPhase]}</span>
        </div>
        <div className="text-slate-300">
          Segment : <span className="font-medium">{SEGMENT_LABELS[player.matchSegment]}</span>
        </div>
        <div className="mt-1 text-xs text-slate-400">Attaquant : {matchState.attackingTeam}</div>
      </div>

      <div className="border-b border-slate-700 p-3">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Charge</h2>
        <div>
          {player.deviceState.status === 'none' ? '—' : player.deviceState.status}
          {player.deviceState.countdownSeconds !== undefined ? ` — ${player.deviceState.countdownSeconds.toFixed(0)}s` : ''}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Événements récents</h2>
        <ul className="space-y-1">
          {player.recentEvents.length === 0 && <li className="text-slate-500">(aucun pour l'instant)</li>}
          {player.recentEvents.map((e, i) => (
            <li key={`${e.tick}-${i}`} className="text-xs text-slate-200">
              <span className="text-slate-500">t{e.tick}</span> {describeEvent(e)}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
