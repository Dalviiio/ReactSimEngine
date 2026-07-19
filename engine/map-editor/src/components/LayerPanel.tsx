import type { Dispatch } from 'react';
import type { EditorAction } from '../state/reducer';
import type { EditorState } from '../state/types';

interface LayerPanelProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

const LAYERS: { key: keyof EditorState['layers']; label: string }[] = [
  { key: 'image', label: 'Image de fond' },
  { key: 'zones', label: 'Zones' },
  { key: 'walls', label: 'Murs' },
  { key: 'boxes', label: 'Caisses' },
];

export function LayerPanel({ state, dispatch }: LayerPanelProps) {
  return (
    <div className="border-b border-slate-700 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Calques</h3>
      <div className="flex flex-col gap-1.5">
        {LAYERS.map((layer) => (
          <label key={layer.key} className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={state.layers[layer.key]}
              onChange={() => dispatch({ type: 'TOGGLE_LAYER', layer: layer.key })}
            />
            {layer.label}
          </label>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-500">
        Astuce : masquer un calque le rend aussi non cliquable, pratique pour dessiner par-dessus sans sélectionner
        d'éléments existants par erreur.
      </p>
    </div>
  );
}
