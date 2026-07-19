import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, WheelEvent } from 'react';
import { BOX_SIZE_COLORS, DEVICE_STATUS_LABELS, EFFECT_TYPE_STYLE, TEAM_COLORS, TEAM_COLOR_DEAD, WALL_COLOR, ZONE_TYPE_COLORS, ZOOM_MAX, ZOOM_MIN } from '../constants';
import type { DerivedDeviceState, ReplayPlayerApi } from '../state/useReplayPlayer';
import type { EntityState, MapData, Point, ReplayAbilityEffect } from '../types';
import { pointsToAttr } from '../utils/geometry';

interface ReplayCanvasProps {
  mapData: MapData;
  mapImageDataUrl?: string;
  player: ReplayPlayerApi;
  teamOrder: string[];
}

function polygonCentroid(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function teamColor(team: string, teamOrder: string[]): string {
  const index = teamOrder.indexOf(team);
  return TEAM_COLORS[index] ?? '#a3a3a3';
}

function DeviceMarker({ mapData, deviceState }: { mapData: MapData; deviceState: DerivedDeviceState }) {
  if (deviceState.status === 'none' || deviceState.status === 'carried') return null;
  const zone = deviceState.zoneId ? mapData.zones.find((z) => z.id === deviceState.zoneId) : undefined;
  const center = zone ? polygonCentroid(zone.polygon) : { x: mapData.width / 2, y: mapData.height / 2 };
  const color = deviceState.status === 'detonated' ? '#ef4444' : deviceState.status === 'defused' ? '#22c55e' : '#facc15';

  return (
    <g pointerEvents="none">
      <circle cx={center.x} cy={center.y} r={10} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.5} />
      <circle cx={center.x} cy={center.y} r={3} fill={color} />
      <text x={center.x} y={center.y - 14} fontSize={7} textAnchor="middle" fill={color} fontWeight="bold">
        {DEVICE_STATUS_LABELS[deviceState.status]}
        {deviceState.countdownSeconds !== undefined ? ` (${deviceState.countdownSeconds.toFixed(0)}s)` : ''}
      </text>
    </g>
  );
}

function EffectMarker({ effect, currentTick }: { effect: ReplayAbilityEffect; currentTick: number }) {
  const style = EFFECT_TYPE_STYLE[effect.type];
  const priming = effect.activeFromTick !== undefined && currentTick < effect.activeFromTick;

  if (effect.radius <= 0) {
    // Effet ponctuel (ex: stealth, marqueur sans zone) : petit indicateur discret, pas de disque.
    return <circle cx={effect.position.x} cy={effect.position.y} r={2} fill={style.color} fillOpacity={0.8} pointerEvents="none" />;
  }

  return (
    <g pointerEvents="none">
      <circle
        cx={effect.position.x}
        cy={effect.position.y}
        r={effect.radius}
        fill={style.color}
        fillOpacity={priming ? 0.08 : 0.22}
        stroke={style.color}
        strokeWidth={priming ? 1 : 1.5}
        strokeDasharray={priming ? '4 3' : undefined}
      />
    </g>
  );
}

function EntityMarker({ entity, color, agentId }: { entity: EntityState; color: string; agentId?: string }) {
  const dead = entity.status !== 'alive';
  const fill = dead ? TEAM_COLOR_DEAD : color;
  const rad = (entity.rotation * Math.PI) / 180;
  const facingX = entity.position.x + Math.cos(rad) * 8;
  const facingY = entity.position.y + Math.sin(rad) * 8;

  return (
    <g opacity={dead ? 0.35 : 1} pointerEvents="none">
      {!dead && <line x1={entity.position.x} y1={entity.position.y} x2={facingX} y2={facingY} stroke={fill} strokeWidth={1.5} />}
      <circle cx={entity.position.x} cy={entity.position.y} r={4} fill={fill} stroke="#0f172a" strokeWidth={0.75} />
      {dead && (
        <>
          <line x1={entity.position.x - 3} y1={entity.position.y - 3} x2={entity.position.x + 3} y2={entity.position.y + 3} stroke="#0f172a" strokeWidth={1} />
          <line x1={entity.position.x - 3} y1={entity.position.y + 3} x2={entity.position.x + 3} y2={entity.position.y - 3} stroke="#0f172a" strokeWidth={1} />
        </>
      )}
      <text x={entity.position.x} y={entity.position.y - 7} fontSize={5.5} textAnchor="middle" fill="#f8fafc">
        {entity.id}
        {agentId ? ` (${agentId})` : ''}
      </text>
      {!dead && entity.health < 100 && (
        <rect x={entity.position.x - 6} y={entity.position.y + 6} width={(entity.health / 100) * 12} height={1.5} fill="#22c55e" />
      )}
    </g>
  );
}

export function ReplayCanvas({ mapData, mapImageDataUrl, player, teamOrder }: ReplayCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);

  // Cadre automatiquement la carte dans la vue à l'ouverture d'un nouveau replay (une carte
  // 300x200 perdue dans un canvas de ~1000x800px au zoom par défaut serait illisible).
  useEffect(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const padding = 40;
    const fitZoom = Math.min((rect.width - padding * 2) / mapData.width, (rect.height - padding * 2) / mapData.height);
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fitZoom));
    setZoom(clamped);
    setPan({ x: (rect.width - mapData.width * clamped) / 2, y: (rect.height - mapData.height * clamped) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapData]);

  const getRect = () => containerRef.current!.getBoundingClientRect();

  const handleWheel = (e: WheelEvent<SVGSVGElement>) => {
    const rect = getRect();
    const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const before = { x: (cursor.x - pan.x) / zoom, y: (cursor.y - pan.y) / zoom };
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    setZoom(newZoom);
    setPan({ x: cursor.x - before.x * newZoom, y: cursor.y - before.y * newZoom });
  };

  const handleMouseDown = (e: MouseEvent<SVGSVGElement>) => {
    setIsPanning(true);
    const start = { x: e.clientX, y: e.clientY };
    const startPan = pan;
    const onMove = (ev: globalThis.MouseEvent) => {
      setPan({ x: startPan.x + (ev.clientX - start.x), y: startPan.y + (ev.clientY - start.y) });
    };
    const onUp = () => {
      setIsPanning(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden bg-slate-900">
      <svg
        className="h-full w-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {mapImageDataUrl ? (
            <image href={mapImageDataUrl} x={0} y={0} width={mapData.width} height={mapData.height} />
          ) : (
            <rect x={0} y={0} width={mapData.width} height={mapData.height} fill="#1e293b" />
          )}

          {mapData.zones.map((zone) => (
            <g key={zone.id}>
              <polygon points={pointsToAttr(zone.polygon)} fill={ZONE_TYPE_COLORS[zone.type]} fillOpacity={0.16} stroke={ZONE_TYPE_COLORS[zone.type]} strokeWidth={1 / zoom} />
            </g>
          ))}

          {mapData.walls.map((wall) => (
            <polyline key={wall.id} points={pointsToAttr(wall.points)} fill="none" stroke={WALL_COLOR} strokeWidth={3.5 / zoom} />
          ))}

          {mapData.boxes.map((box) => (
            <rect
              key={box.id}
              x={box.position.x - box.width / 2}
              y={box.position.y - box.height / 2}
              width={box.width}
              height={box.height}
              fill={BOX_SIZE_COLORS[box.size]}
              fillOpacity={0.85}
              stroke="#00000066"
              strokeWidth={1 / zoom}
            />
          ))}

          {player.visibleEffects.map((effect) => (
            <EffectMarker key={effect.id} effect={effect} currentTick={player.currentTick} />
          ))}

          <DeviceMarker mapData={mapData} deviceState={player.deviceState} />

          {player.entities.map((entity) => (
            <EntityMarker key={entity.id} entity={entity} color={teamColor(entity.team, teamOrder)} agentId={entity.abilityLoadout?.agentId} />
          ))}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-800/80 px-2 py-1 text-[10px] text-slate-300">
        Molette : zoom — glisser : déplacer
      </div>
    </div>
  );
}
