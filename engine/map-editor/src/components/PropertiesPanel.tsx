import type { Dispatch } from 'react';
import { BOX_SIZE_LABELS, ZONE_TYPE_LABELS } from '../constants';
import type { EditorAction } from '../state/reducer';
import type { BoxSize, EditorState, ZoneType } from '../state/types';

interface PropertiesPanelProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

export function PropertiesPanel({ state, dispatch }: PropertiesPanelProps) {
  const { selected } = state;

  if (!selected) {
    return <div className="p-3 text-sm text-slate-500">Aucun élément sélectionné.</div>;
  }

  if (selected.kind === 'zone') {
    const zone = state.zones.find((z) => z.id === selected.id);
    if (!zone) return null;
    return (
      <div className="flex flex-col gap-3 p-3 text-sm text-slate-200">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Zone sélectionnée</h3>
        <label className="flex flex-col gap-1">
          Nom
          <input
            className="rounded bg-slate-700 px-2 py-1"
            value={zone.name}
            onChange={(e) => dispatch({ type: 'UPDATE_ZONE_NAME', id: zone.id, name: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Type
          <select
            className="rounded bg-slate-700 px-2 py-1"
            value={zone.type}
            onChange={(e) => dispatch({ type: 'UPDATE_ZONE_TYPE', id: zone.id, zoneType: e.target.value as ZoneType })}
          >
            {(Object.keys(ZONE_TYPE_LABELS) as ZoneType[]).map((type) => (
              <option key={type} value={type}>
                {ZONE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500">{zone.polygon.length} points — glissez les points ou la forme pour modifier.</p>
      </div>
    );
  }

  if (selected.kind === 'wall') {
    const wall = state.walls.find((w) => w.id === selected.id);
    if (!wall) return null;
    return (
      <div className="flex flex-col gap-2 p-3 text-sm text-slate-200">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Mur sélectionné</h3>
        <p className="text-xs text-slate-500">{wall.points.length} points — glissez les points ou le mur pour modifier.</p>
      </div>
    );
  }

  const box = state.boxes.find((b) => b.id === selected.id);
  if (!box) return null;
  return (
    <div className="flex flex-col gap-3 p-3 text-sm text-slate-200">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Caisse sélectionnée</h3>
      <label className="flex flex-col gap-1">
        Taille
        <select
          className="rounded bg-slate-700 px-2 py-1"
          value={box.size}
          onChange={(e) => dispatch({ type: 'UPDATE_BOX_SIZE', id: box.id, size: e.target.value as BoxSize })}
        >
          {(Object.keys(BOX_SIZE_LABELS) as BoxSize[]).map((size) => (
            <option key={size} value={size}>
              {BOX_SIZE_LABELS[size]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate-500">
        Position : ({Math.round(box.position.x)}, {Math.round(box.position.y)})
      </p>
    </div>
  );
}
