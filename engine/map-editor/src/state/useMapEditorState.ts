import { useReducer } from 'react';
import { editorReducer } from './reducer';
import { initialEditorState } from './types';

export function useMapEditorState() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  return { state, dispatch };
}
