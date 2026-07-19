import { AgentDefinition } from '../integration';
import { VANGUARD } from './vanguard';
import { GALE } from './gale';
import { ARCHITECT } from './architect';
import { AEGIS } from './aegis';
import { SCOUT } from './scout';
import { EMBER } from './ember';
import { WARP } from './warp';
import { BRAMBLE } from './bramble';
import { HAVOC } from './havoc';
import { VESPER } from './vesper';

export { VANGUARD, SCOUT, GALE, AEGIS, ARCHITECT, EMBER, WARP, BRAMBLE, HAVOC, VESPER };

export const AGENT_REGISTRY: Record<string, AgentDefinition> = {
  [VANGUARD.agentId]: VANGUARD,
  [SCOUT.agentId]: SCOUT,
  [GALE.agentId]: GALE,
  [AEGIS.agentId]: AEGIS,
  [ARCHITECT.agentId]: ARCHITECT,
  [EMBER.agentId]: EMBER,
  [WARP.agentId]: WARP,
  [BRAMBLE.agentId]: BRAMBLE,
  [HAVOC.agentId]: HAVOC,
  [VESPER.agentId]: VESPER,
};
