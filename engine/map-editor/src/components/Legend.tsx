import { BOX_SIZE_COLORS, BOX_SIZE_LABELS, BOX_SIZE_RULES, WALL_COLOR, ZONE_TYPE_COLORS, ZONE_TYPE_LABELS } from '../constants';
import type { BoxSize, ZoneType } from '../state/types';

export function Legend() {
  const boxSizes = Object.keys(BOX_SIZE_LABELS) as BoxSize[];
  const zoneTypes = Object.keys(ZONE_TYPE_LABELS) as ZoneType[];

  return (
    <div className="p-3 text-sm text-slate-200">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Légende — caisses</h3>
      <ul className="mb-3 flex flex-col gap-1.5">
        {boxSizes.map((size) => (
          <li key={size} className="flex items-start gap-2">
            <span className="mt-0.5 h-3 w-3 flex-shrink-0 rounded-sm" style={{ backgroundColor: BOX_SIZE_COLORS[size] }} />
            <span className="text-xs">
              <strong>{BOX_SIZE_LABELS[size]}</strong> — {BOX_SIZE_RULES[size]}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Légende — zones &amp; murs</h3>
      <ul className="flex flex-col gap-1.5 text-xs">
        {zoneTypes.map((type) => (
          <li key={type} className="flex items-center gap-2">
            <span className="h-3 w-3 flex-shrink-0 rounded-sm" style={{ backgroundColor: ZONE_TYPE_COLORS[type] }} />
            {ZONE_TYPE_LABELS[type]}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="h-1 w-3 flex-shrink-0" style={{ backgroundColor: WALL_COLOR }} />
          Mur (bloque déplacement + tir)
        </li>
      </ul>
    </div>
  );
}
