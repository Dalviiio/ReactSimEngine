// Types de l'éditeur : réutilise les types partagés du moteur (engine/types/map.ts),
// ne les redéfinit pas.
import type { Box, BoxSize, Point, Wall, Zone, ZoneType } from '../../../types';

export type { Box, BoxSize, Point, Wall, Zone, ZoneType };

export type EditorMode = 'select' | 'zone' | 'wall' | 'box';
export type SelectedKind = 'zone' | 'wall' | 'box';

export interface Selection {
  kind: SelectedKind;
  id: string;
}

export interface LayerVisibility {
  image: boolean;
  zones: boolean;
  walls: boolean;
  boxes: boolean;
}

export interface EditorState {
  mapId: string;
  mapName: string;
  /** URL objet (blob:) utilisée pour l'aperçu dans le canvas, pas exportée telle quelle. */
  imageObjectUrl: string | null;
  /** Nom de fichier de l'image, stocké dans MapData.imageUrl à l'export. */
  imageFileName: string;
  imageWidth: number;
  imageHeight: number;
  zones: Zone[];
  walls: Wall[];
  boxes: Box[];
  /** Points posés pour le polygone en cours de dessin (zone ou mur), avant validation. */
  draft: Point[];
  mode: EditorMode;
  activeBoxSize: BoxSize;
  selected: Selection | null;
  layers: LayerVisibility;
  zoom: number;
  pan: Point;
  /** Message transitoire affiché à l'utilisateur (succès export, erreur validation, etc.). */
  notice: string | null;
}

export const initialEditorState: EditorState = {
  mapId: 'new_map',
  mapName: 'Nouvelle carte',
  imageObjectUrl: null,
  imageFileName: '',
  imageWidth: 0,
  imageHeight: 0,
  zones: [],
  walls: [],
  boxes: [],
  draft: [],
  mode: 'select',
  activeBoxSize: 'medium',
  selected: null,
  layers: { image: true, zones: true, walls: true, boxes: true },
  zoom: 1,
  pan: { x: 0, y: 0 },
  notice: null,
};
