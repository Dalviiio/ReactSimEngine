import type { Dispatch } from 'react';
import { ZOOM_MAX, ZOOM_MIN, BOX_SIZE_LABELS } from '../constants';
import type { EditorAction } from '../state/reducer';
import type { BoxSize, EditorMode, EditorState } from '../state/types';

interface ToolbarProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

const MODES: { value: EditorMode; label: string }[] = [
  { value: 'select', label: 'Sélection' },
  { value: 'zone', label: 'Zone' },
  { value: 'wall', label: 'Mur' },
  { value: 'box', label: 'Caisse' },
];

export function Toolbar({ state, dispatch }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100">
      <div className="flex gap-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => dispatch({ type: 'SET_MODE', mode: m.value })}
            className={`rounded px-3 py-1.5 transition ${
              state.mode === m.value ? 'bg-sky-600 text-white' : 'bg-slate-700 hover:bg-slate-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {state.mode === 'box' && (
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Taille :</span>
          <select
            value={state.activeBoxSize}
            onChange={(e) => dispatch({ type: 'SET_ACTIVE_BOX_SIZE', size: e.target.value as BoxSize })}
            className="rounded bg-slate-700 px-2 py-1"
          >
            {(Object.keys(BOX_SIZE_LABELS) as BoxSize[]).map((size) => (
              <option key={size} value={size}>
                {BOX_SIZE_LABELS[size]}
              </option>
            ))}
          </select>
        </div>
      )}

      {(state.mode === 'zone' || state.mode === 'wall') && (
        <span className="text-xs text-slate-400">
          {state.draft.length > 0
            ? `${state.draft.length} point(s) — Entrée ou double-clic pour valider, Échap pour annuler`
            : 'Cliquez sur le canvas pour poser des points'}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
          onClick={() => dispatch({ type: 'SET_ZOOM', zoom: Math.max(ZOOM_MIN, state.zoom / 1.2) })}
        >
          −
        </button>
        <span className="w-14 text-center text-slate-300">{Math.round(state.zoom * 100)}%</span>
        <button
          className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
          onClick={() => dispatch({ type: 'SET_ZOOM', zoom: Math.min(ZOOM_MAX, state.zoom * 1.2) })}
        >
          +
        </button>
        <button
          className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600"
          onClick={() => {
            dispatch({ type: 'SET_ZOOM', zoom: 1 });
            dispatch({ type: 'SET_PAN', pan: { x: 0, y: 0 } });
          }}
        >
          Réinitialiser vue
        </button>
        {state.selected && (
          <button
            className="rounded bg-red-700 px-3 py-1.5 hover:bg-red-600"
            onClick={() => dispatch({ type: 'DELETE_SELECTED' })}
          >
            Supprimer la sélection
          </button>
        )}
      </div>
    </div>
  );
}
