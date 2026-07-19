import { EntityState } from '../types';
import { EventBus } from './eventBus';

/**
 * Gestion des entités (ajout/suppression/update). Toute mutation émet un
 * événement sur le bus fourni pour que la simulation (ou tout autre module)
 * puisse le tracer sans être couplé à l'implémentation interne.
 */
export class EntityManager {
  private entities = new Map<string, EntityState>();

  constructor(private eventBus: EventBus) {}

  addEntity(entity: EntityState): void {
    this.entities.set(entity.id, entity);
    this.eventBus.emit('entity:added', entity);
  }

  removeEntity(id: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.entities.delete(id);
    this.eventBus.emit('entity:removed', entity);
  }

  updateEntity(id: string, changes: Partial<EntityState>): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    const updated: EntityState = { ...entity, ...changes };
    this.entities.set(id, updated);
    this.eventBus.emit('entity:updated', updated);
  }

  getEntity(id: string): EntityState | undefined {
    return this.entities.get(id);
  }

  getAllEntities(): EntityState[] {
    return Array.from(this.entities.values());
  }
}
