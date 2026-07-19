export type EventHandler<T = unknown> = (payload: T) => void;
export type WildcardEventHandler = (type: string, payload: unknown) => void;

/**
 * Bus d'événements minimal (emit/subscribe) permettant aux futurs modules
 * (IA, règles de jeu, etc.) de réagir à ce qui se passe dans la simulation
 * sans être couplés entre eux ni au moteur.
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private wildcardHandlers = new Set<WildcardEventHandler>();

  on<T = unknown>(type: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as EventHandler);
    return () => this.off(type, handler as EventHandler);
  }

  /** S'abonne à TOUS les événements, quel que soit leur type (ex: pour les journaliser). */
  onAny(handler: WildcardEventHandler): () => void {
    this.wildcardHandlers.add(handler);
    return () => this.wildcardHandlers.delete(handler);
  }

  off(type: string, handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit<T = unknown>(type: string, payload: T): void {
    this.handlers.get(type)?.forEach((handler) => handler(payload));
    this.wildcardHandlers.forEach((handler) => handler(type, payload));
  }

  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }
}
