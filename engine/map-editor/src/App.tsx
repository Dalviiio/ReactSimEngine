import { useEffect } from 'react';
import { ImportExportBar } from './components/ImportExportBar';
import { LayerPanel } from './components/LayerPanel';
import { Legend } from './components/Legend';
import { MapCanvas } from './components/MapCanvas';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar } from './components/Toolbar';
import { useMapEditorState } from './state/useMapEditorState';
import { isTypingTarget } from './utils/dom';

export default function App() {
  const { state, dispatch } = useMapEditorState();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Enter') {
        if (state.draft.length > 0) dispatch({ type: 'FINALIZE_DRAFT' });
      } else if (e.key === 'Escape') {
        if (state.draft.length > 0) dispatch({ type: 'CANCEL_DRAFT' });
        else if (state.selected) dispatch({ type: 'SELECT', selection: null });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selected) dispatch({ type: 'DELETE_SELECTED' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.draft, state.selected, dispatch]);

  useEffect(() => {
    if (!state.notice) return;
    const timer = setTimeout(() => dispatch({ type: 'SET_NOTICE', notice: null }), 4000);
    return () => clearTimeout(timer);
  }, [state.notice, dispatch]);

  return (
    <div className="relative flex h-screen flex-col bg-slate-900 text-slate-100">
      <header className="border-b border-slate-700 bg-slate-800 px-4 py-2">
        <h1 className="text-base font-semibold">Map Editor — ReactSimEngine</h1>
        <p className="text-xs text-slate-400">
          Outil autonome pour produire des fichiers MapData. Aucune logique de simulation, d'IA ou de pathfinding ici.
        </p>
      </header>

      <ImportExportBar state={state} dispatch={dispatch} />
      <Toolbar state={state} dispatch={dispatch} />

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 overflow-y-auto border-r border-slate-700 bg-slate-800">
          <LayerPanel state={state} dispatch={dispatch} />
          <Legend />
        </aside>

        <MapCanvas state={state} dispatch={dispatch} />

        <aside className="w-64 overflow-y-auto border-l border-slate-700 bg-slate-800">
          <PropertiesPanel state={state} dispatch={dispatch} />
        </aside>
      </div>

      {state.notice && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-slate-800 px-4 py-2 text-sm shadow-lg ring-1 ring-slate-600">
          {state.notice}
        </div>
      )}
    </div>
  );
}
