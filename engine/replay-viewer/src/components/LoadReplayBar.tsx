import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { MatchReplay } from '../types';

interface LoadReplayBarProps {
  onLoaded: (replay: MatchReplay) => void;
  replay: MatchReplay | null;
}

/** Validation minimale (pas de schéma complet comme mapValidator.ts — le format MatchReplay n'a pas encore de validateur partagé) : vérifie juste la présence des champs structurants avant d'accepter le fichier. */
function looksLikeMatchReplay(value: unknown): value is MatchReplay {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.tickDeltas) && Array.isArray(v.keyframes) && Array.isArray(v.roundIndex) && !!v.mapData && !!v.matchState;
}

export function LoadReplayBar({ onLoaded, replay }: LoadReplayBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!looksLikeMatchReplay(parsed)) {
        setError('Ce fichier ne ressemble pas à un MatchReplay valide (champs attendus manquants).');
        return;
      }
      onLoaded(parsed);
    } catch (err) {
      setError(`Impossible de lire le fichier : ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-slate-700 bg-slate-800 px-4 py-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
      >
        Charger un replay
      </button>
      <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFile} />
      {replay && (
        <span className="text-xs text-slate-400">
          {replay.replayId} — {replay.mapData.name} — enregistré le {new Date(replay.recordedAt).toLocaleString('fr-FR')}
        </span>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
