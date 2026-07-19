export interface TickLoopConfig {
  /** Ticks par seconde, ex: 30. */
  tickRate: number;
}

export type TickCallback = (tick: number, timestamp: number) => void;

/**
 * Boucle de tick basique. Deux modes d'usage :
 * - `runFixedTicks` : avance N ticks immédiatement (synchrone), pour les tests/replays.
 * - `start`/`stop` : boucle temps réel basée sur `setInterval`, pour une future exécution live.
 */
export class TickLoop {
  private readonly tickIntervalMs: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentTick = 0;

  constructor(config: TickLoopConfig) {
    this.tickIntervalMs = 1000 / config.tickRate;
  }

  get tickDurationMs(): number {
    return this.tickIntervalMs;
  }

  start(onTick: TickCallback): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.currentTick += 1;
      onTick(this.currentTick, this.currentTick * this.tickIntervalMs);
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  runFixedTicks(tickCount: number, onTick: TickCallback): void {
    for (let i = 1; i <= tickCount; i += 1) {
      this.currentTick = i;
      onTick(i, i * this.tickIntervalMs);
    }
  }

  reset(): void {
    this.currentTick = 0;
  }
}
