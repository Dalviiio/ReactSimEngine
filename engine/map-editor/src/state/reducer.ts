import { BOX_SIZE_DIMENSIONS } from '../constants';
import { genId } from '../utils/id';
import type { Box, BoxSize, EditorMode, EditorState, Point, Selection, Wall, Zone, ZoneType } from './types';
import { initialEditorState } from './types';

export type EditorAction =
  | { type: 'SET_IMAGE'; objectUrl: string; fileName: string; width: number; height: number }
  | { type: 'SET_MAP_META'; id?: string; name?: string }
  | { type: 'SET_MODE'; mode: EditorMode }
  | { type: 'SET_ACTIVE_BOX_SIZE'; size: BoxSize }
  | { type: 'ADD_DRAFT_POINT'; point: Point }
  | { type: 'FINALIZE_DRAFT'; dropLast?: boolean }
  | { type: 'CANCEL_DRAFT' }
  | { type: 'PLACE_BOX'; point: Point }
  | { type: 'SELECT'; selection: Selection | null }
  | { type: 'DELETE_SELECTED' }
  | { type: 'UPDATE_ZONE_NAME'; id: string; name: string }
  | { type: 'UPDATE_ZONE_TYPE'; id: string; zoneType: ZoneType }
  | { type: 'UPDATE_BOX_SIZE'; id: string; size: BoxSize }
  | { type: 'SET_ZONE_POLYGON'; id: string; polygon: Point[] }
  | { type: 'SET_WALL_POINTS'; id: string; points: Point[] }
  | { type: 'SET_BOX_POSITION'; id: string; position: Point }
  | { type: 'TOGGLE_LAYER'; layer: keyof EditorState['layers'] }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SET_PAN'; pan: Point }
  | { type: 'SET_NOTICE'; notice: string | null }
  | {
      type: 'IMPORT_MAP';
      data: { id: string; name: string; imageUrl: string; width: number; height: number; zones: Zone[]; walls: Wall[]; boxes: Box[] };
    }
  | { type: 'RESET' };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_IMAGE':
      return {
        ...state,
        imageObjectUrl: action.objectUrl,
        imageFileName: action.fileName,
        imageWidth: action.width,
        imageHeight: action.height,
        zoom: 1,
        pan: { x: 0, y: 0 },
      };

    case 'SET_MAP_META':
      return {
        ...state,
        mapId: action.id ?? state.mapId,
        mapName: action.name ?? state.mapName,
      };

    case 'SET_MODE':
      return {
        ...state,
        mode: action.mode,
        draft: [],
        selected: state.mode === action.mode ? state.selected : null,
      };

    case 'SET_ACTIVE_BOX_SIZE':
      return { ...state, activeBoxSize: action.size };

    case 'ADD_DRAFT_POINT':
      return { ...state, draft: [...state.draft, action.point] };

    case 'CANCEL_DRAFT':
      return { ...state, draft: [] };

    case 'FINALIZE_DRAFT': {
      const points = action.dropLast ? state.draft.slice(0, -1) : state.draft;

      if (state.mode === 'zone') {
        if (points.length < 3) {
          return { ...state, draft: [], notice: 'Une zone nécessite au moins 3 points.' };
        }
        const zone: Zone = {
          id: genId('zone'),
          name: `Zone ${state.zones.length + 1}`,
          type: 'open_area',
          polygon: points,
        };
        return { ...state, zones: [...state.zones, zone], draft: [], selected: { kind: 'zone', id: zone.id } };
      }

      if (state.mode === 'wall') {
        if (points.length < 2) {
          return { ...state, draft: [], notice: 'Un mur nécessite au moins 2 points.' };
        }
        const wall: Wall = { id: genId('wall'), points };
        return { ...state, walls: [...state.walls, wall], draft: [], selected: { kind: 'wall', id: wall.id } };
      }

      return { ...state, draft: [] };
    }

    case 'PLACE_BOX': {
      const dims = BOX_SIZE_DIMENSIONS[state.activeBoxSize];
      const box: Box = {
        id: genId('box'),
        position: action.point,
        width: dims.width,
        height: dims.height,
        size: state.activeBoxSize,
      };
      return { ...state, boxes: [...state.boxes, box], selected: { kind: 'box', id: box.id } };
    }

    case 'SELECT':
      return { ...state, selected: action.selection };

    case 'DELETE_SELECTED': {
      if (!state.selected) return state;
      const { kind, id } = state.selected;
      if (kind === 'zone') return { ...state, zones: state.zones.filter((z) => z.id !== id), selected: null };
      if (kind === 'wall') return { ...state, walls: state.walls.filter((w) => w.id !== id), selected: null };
      return { ...state, boxes: state.boxes.filter((b) => b.id !== id), selected: null };
    }

    case 'UPDATE_ZONE_NAME':
      return { ...state, zones: state.zones.map((z) => (z.id === action.id ? { ...z, name: action.name } : z)) };

    case 'UPDATE_ZONE_TYPE':
      return { ...state, zones: state.zones.map((z) => (z.id === action.id ? { ...z, type: action.zoneType } : z)) };

    case 'UPDATE_BOX_SIZE': {
      const dims = BOX_SIZE_DIMENSIONS[action.size];
      return {
        ...state,
        boxes: state.boxes.map((b) =>
          b.id === action.id ? { ...b, size: action.size, width: dims.width, height: dims.height } : b,
        ),
      };
    }

    case 'SET_ZONE_POLYGON':
      return { ...state, zones: state.zones.map((z) => (z.id === action.id ? { ...z, polygon: action.polygon } : z)) };

    case 'SET_WALL_POINTS':
      return { ...state, walls: state.walls.map((w) => (w.id === action.id ? { ...w, points: action.points } : w)) };

    case 'SET_BOX_POSITION':
      return { ...state, boxes: state.boxes.map((b) => (b.id === action.id ? { ...b, position: action.position } : b)) };

    case 'TOGGLE_LAYER':
      return { ...state, layers: { ...state.layers, [action.layer]: !state.layers[action.layer] } };

    case 'SET_ZOOM':
      return { ...state, zoom: action.zoom };

    case 'SET_PAN':
      return { ...state, pan: action.pan };

    case 'SET_NOTICE':
      return { ...state, notice: action.notice };

    case 'IMPORT_MAP':
      return {
        ...state,
        mapId: action.data.id,
        mapName: action.data.name,
        imageFileName: action.data.imageUrl,
        imageObjectUrl: null,
        imageWidth: action.data.width,
        imageHeight: action.data.height,
        zones: action.data.zones,
        walls: action.data.walls,
        boxes: action.data.boxes,
        selected: null,
        draft: [],
        zoom: 1,
        pan: { x: 0, y: 0 },
        notice: "Carte importée. Sélectionnez l'image associée si elle ne s'affiche pas.",
      };

    case 'RESET':
      return initialEditorState;

    default:
      return state;
  }
}
