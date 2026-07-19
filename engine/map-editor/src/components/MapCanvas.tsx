import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MouseEvent, WheelEvent } from 'react';
import { BOX_SIZE_COLORS, WALL_COLOR, ZONE_TYPE_COLORS, ZOOM_MAX, ZOOM_MIN } from '../constants';
import type { EditorAction } from '../state/reducer';
import type { EditorState, Point } from '../state/types';
import { isTypingTarget } from '../utils/dom';
import { startWindowDrag } from '../utils/dragSession';
import { pointsToAttr, screenToMap } from '../utils/geometry';

interface MapCanvasProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

export function MapCanvas({ state, dispatch }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const { zoom, pan, zones, walls, boxes, draft, mode, layers, selected, imageObjectUrl, imageWidth, imageHeight } = state;
  const interactive = mode === 'select';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const getRect = () => containerRef.current!.getBoundingClientRect();

  const handleWheel = (e: WheelEvent<SVGSVGElement>) => {
    const rect = getRect();
    const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const before = { x: (cursor.x - pan.x) / zoom, y: (cursor.y - pan.y) / zoom };
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    const newPan = { x: cursor.x - before.x * newZoom, y: cursor.y - before.y * newZoom };
    dispatch({ type: 'SET_ZOOM', zoom: newZoom });
    dispatch({ type: 'SET_PAN', pan: newPan });
  };

  const handleBackgroundMouseDown = (e: MouseEvent<SVGSVGElement>) => {
    const rect = getRect();

    if (spaceDown || e.button === 1) {
      e.preventDefault();
      const startPan = pan;
      const startClient = { x: e.clientX, y: e.clientY };
      startWindowDrag((ev) => {
        dispatch({
          type: 'SET_PAN',
          pan: { x: startPan.x + (ev.clientX - startClient.x), y: startPan.y + (ev.clientY - startClient.y) },
        });
      });
      return;
    }

    const point = screenToMap(rect, e.clientX, e.clientY, pan, zoom);

    if (mode === 'zone' || mode === 'wall') {
      dispatch({ type: 'ADD_DRAFT_POINT', point });
    } else if (mode === 'box') {
      dispatch({ type: 'PLACE_BOX', point });
    } else {
      dispatch({ type: 'SELECT', selection: null });
    }
  };

  const handleBackgroundDoubleClick = () => {
    if (mode === 'zone' || mode === 'wall') {
      dispatch({ type: 'FINALIZE_DRAFT', dropLast: true });
    }
  };

  const startShapeDrag = (
    e: MouseEvent<SVGElement>,
    kind: 'zone' | 'wall' | 'box',
    id: string,
    original: { points?: Point[]; position?: Point },
  ) => {
    e.stopPropagation();
    dispatch({ type: 'SELECT', selection: { kind, id } });
    const startClient = { x: e.clientX, y: e.clientY };

    startWindowDrag((ev) => {
      const dx = (ev.clientX - startClient.x) / zoom;
      const dy = (ev.clientY - startClient.y) / zoom;

      if (kind === 'zone' && original.points) {
        dispatch({ type: 'SET_ZONE_POLYGON', id, polygon: original.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
      } else if (kind === 'wall' && original.points) {
        dispatch({ type: 'SET_WALL_POINTS', id, points: original.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
      } else if (kind === 'box' && original.position) {
        dispatch({ type: 'SET_BOX_POSITION', id, position: { x: original.position.x + dx, y: original.position.y + dy } });
      }
    });
  };

  const startVertexDrag = (e: MouseEvent<SVGElement>, kind: 'zone' | 'wall', id: string, index: number, points: Point[]) => {
    e.stopPropagation();
    const startClient = { x: e.clientX, y: e.clientY };
    const original = points[index];

    startWindowDrag((ev) => {
      const dx = (ev.clientX - startClient.x) / zoom;
      const dy = (ev.clientY - startClient.y) / zoom;
      const newPoints = points.map((p, i) => (i === index ? { x: original.x + dx, y: original.y + dy } : p));
      if (kind === 'zone') {
        dispatch({ type: 'SET_ZONE_POLYGON', id, polygon: newPoints });
      } else {
        dispatch({ type: 'SET_WALL_POINTS', id, points: newPoints });
      }
    });
  };

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden bg-slate-900">
      <svg
        className="h-full w-full"
        onWheel={handleWheel}
        onMouseDown={handleBackgroundMouseDown}
        onDoubleClick={handleBackgroundDoubleClick}
        style={{ cursor: spaceDown ? 'grab' : mode === 'select' ? 'default' : 'crosshair' }}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {layers.image && imageObjectUrl && (
            <image href={imageObjectUrl} x={0} y={0} width={imageWidth} height={imageHeight} />
          )}
          {!imageObjectUrl && <rect x={0} y={0} width={1000} height={1000} fill="#1e293b" />}

          {layers.zones &&
            zones.map((zone) => {
              const isSelected = selected?.kind === 'zone' && selected.id === zone.id;
              return (
                <g key={zone.id}>
                  <polygon
                    points={pointsToAttr(zone.polygon)}
                    fill={ZONE_TYPE_COLORS[zone.type]}
                    fillOpacity={0.28}
                    stroke={ZONE_TYPE_COLORS[zone.type]}
                    strokeWidth={(isSelected ? 3 : 2) / zoom}
                    pointerEvents={interactive ? 'all' : 'none'}
                    onMouseDown={(e) => startShapeDrag(e, 'zone', zone.id, { points: zone.polygon })}
                  />
                  {isSelected &&
                    interactive &&
                    zone.polygon.map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={5 / zoom}
                        fill="#ffffff"
                        stroke={ZONE_TYPE_COLORS[zone.type]}
                        strokeWidth={2 / zoom}
                        onMouseDown={(e) => startVertexDrag(e, 'zone', zone.id, i, zone.polygon)}
                      />
                    ))}
                </g>
              );
            })}

          {layers.walls &&
            walls.map((wall) => {
              const isSelected = selected?.kind === 'wall' && selected.id === wall.id;
              return (
                <g key={wall.id}>
                  <polyline
                    points={pointsToAttr(wall.points)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={18 / zoom}
                    pointerEvents={interactive ? 'stroke' : 'none'}
                    onMouseDown={(e) => startShapeDrag(e, 'wall', wall.id, { points: wall.points })}
                  />
                  <polyline
                    points={pointsToAttr(wall.points)}
                    fill="none"
                    stroke={WALL_COLOR}
                    strokeWidth={(isSelected ? 5 : 3.5) / zoom}
                    pointerEvents="none"
                  />
                  {isSelected &&
                    interactive &&
                    wall.points.map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={5 / zoom}
                        fill="#ffffff"
                        stroke={WALL_COLOR}
                        strokeWidth={2 / zoom}
                        onMouseDown={(e) => startVertexDrag(e, 'wall', wall.id, i, wall.points)}
                      />
                    ))}
                </g>
              );
            })}

          {layers.boxes &&
            boxes.map((box) => {
              const isSelected = selected?.kind === 'box' && selected.id === box.id;
              return (
                <rect
                  key={box.id}
                  x={box.position.x - box.width / 2}
                  y={box.position.y - box.height / 2}
                  width={box.width}
                  height={box.height}
                  fill={BOX_SIZE_COLORS[box.size]}
                  fillOpacity={0.85}
                  stroke={isSelected ? '#ffffff' : '#00000066'}
                  strokeWidth={(isSelected ? 3 : 1.5) / zoom}
                  pointerEvents={interactive ? 'all' : 'none'}
                  onMouseDown={(e) => startShapeDrag(e, 'box', box.id, { position: box.position })}
                />
              );
            })}

          {draft.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={pointsToAttr(draft)}
                fill="none"
                stroke={mode === 'wall' ? WALL_COLOR : '#facc15'}
                strokeWidth={2 / zoom}
                strokeDasharray={`${6 / zoom} ${4 / zoom}`}
              />
              {draft.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4 / zoom} fill="#facc15" />
              ))}
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
