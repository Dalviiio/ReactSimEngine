import { useRef } from 'react';
import type { ChangeEvent, Dispatch } from 'react';
import type { EditorAction } from '../state/reducer';
import type { EditorState } from '../state/types';
import { exportMapData } from '../utils/mapExport';
import { parseMapDataFile } from '../utils/mapImport';

interface ImportExportBarProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

export function ImportExportBar({ state, dispatch }: ImportExportBarProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      dispatch({ type: 'SET_IMAGE', objectUrl, fileName: file.name, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = objectUrl;
    e.target.value = '';
  };

  const handleExport = () => {
    const result = exportMapData(state);
    dispatch({
      type: 'SET_NOTICE',
      notice: result.ok ? 'Carte exportée avec succès.' : `Carte invalide : ${result.errors.join(' / ')}`,
    });
  };

  const handleJsonImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseMapDataFile(text);
    if (!result.ok) {
      dispatch({ type: 'SET_NOTICE', notice: `Import impossible : ${result.errors.join(' / ')}` });
    } else {
      dispatch({ type: 'IMPORT_MAP', data: result.data });
    }
    e.target.value = '';
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100">
      <label className="flex items-center gap-1.5">
        ID
        <input
          className="w-32 rounded bg-slate-700 px-2 py-1"
          value={state.mapId}
          onChange={(e) => dispatch({ type: 'SET_MAP_META', id: e.target.value })}
        />
      </label>
      <label className="flex items-center gap-1.5">
        Nom
        <input
          className="w-40 rounded bg-slate-700 px-2 py-1"
          value={state.mapName}
          onChange={(e) => dispatch({ type: 'SET_MAP_META', name: e.target.value })}
        />
      </label>

      <span className="text-xs text-slate-400">
        {state.imageFileName
          ? `Image : ${state.imageFileName} (${state.imageWidth}×${state.imageHeight})`
          : 'Aucune image chargée'}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <button className="rounded bg-slate-700 px-3 py-1.5 hover:bg-slate-600" onClick={() => imageInputRef.current?.click()}>
          Charger l'image (.webp)
        </button>
        <input ref={imageInputRef} type="file" accept="image/webp" className="hidden" onChange={handleImageChange} />

        <button className="rounded bg-slate-700 px-3 py-1.5 hover:bg-slate-600" onClick={() => jsonInputRef.current?.click()}>
          Importer JSON
        </button>
        <input ref={jsonInputRef} type="file" accept="application/json" className="hidden" onChange={handleJsonImport} />

        <button className="rounded bg-emerald-700 px-3 py-1.5 hover:bg-emerald-600" onClick={handleExport}>
          Exporter JSON
        </button>
      </div>
    </div>
  );
}
