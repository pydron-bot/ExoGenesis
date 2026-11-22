/**
 * For headless tests: the sim and the content it reads, from one module graph,
 * so a test can add records (story events...) the sim then sees.
 *   const { module: M } = await runnerImport('tools/sim-entry.ts'); M.content, M.Sim
 */
export { Sim, useRegion } from '../src/sim/core';
export { content } from '../src/content';
export { skirmishHomes } from '../src/sim/core';
export { generateSkirmishMap, mapSide } from '../src/skirmish/mapgen';
export { placeProblem } from '../src/sim/rules';
export { PathGrid } from '../src/sim/path';
export * as planet from '../src/world/planet';
export { conditionMet } from '../src/sim/conditions';
export { sharedOf, applyShared, HOME_REGION } from '../src/sim/campaign';
export { runPlaythrough } from '../src/sim/playthrough';
