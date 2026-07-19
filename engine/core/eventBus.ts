export type EventHandler<T = unknown> = (payload: T) => void;

/**
 * Bus d'événements minimal (emit/subscribe) permettant aux futurs modules
 * (IA, règles de jeu, etc.) de réagir à ce qui se passe dans la simulation
 * sans être couplés entre eux ni au moteur.
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on<T = unknown>(type: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as EventHandler);
    return () => this.off(type, handler as EventHandler);
  }

  off(type: string, handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit<T = unknown>(type: string, payload: T): void {
    this.handlers.get(type)?.forEach((handler) => handler(payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}
