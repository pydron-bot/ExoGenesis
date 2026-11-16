/**
 * Release notes, newest first: what players see under "What's new" (title
 * screen and the ⋯ menu). Every push to main that changes the game adds an
 * entry here and bumps package.json to match (`npm run build` checks:
 * tools/version-check.mjs). Minor for features, patch for fixes. Write for
 * players, not for the code.
 */
export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  notes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '0.10.2',
    date: '2026-11-16',
    title: 'Mouse rotation the right way round',
    notes: [
      'Rotating the view by right-dragging (or shift-dragging) left and right now turns it the other way. Touch is unchanged',
    ],
  },
  {
    version: '0.10.1',
    date: '2026-11-16',
    title: 'Drag orders on slow frames',
    notes: [
      'Dragging from a unit to order it no longer turns into "select all of this type" when the game is running slowly',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-11-16',
    title: 'More units, more buildings, new predators',
    notes: [
      'Four new vehicles at the Vehicle Bay: the fast Scout Skimmer that sees far, the Field Engineer that repairs units and buildings in the field, the Arc Caster whose discharge jumps between targets, and long-range Artillery (it needs something to spot for it)',
      'New defenses: Point Defense for anything that reaches the base, and the Siege Cannon that shells from far out',
      'Gates: drop one onto a wall and it slots in. Your units drive through, predators can\'t',
      'Repair Pad: park damaged units on it to mend them for free while it has power',
      'Geothermal vents glow in the ground. Build a Geothermal Tap on one for steady power all night',
      'New predators in later packs: Spitters attack from just beyond a Defense Turret\'s reach, and Burrowers tunnel under your walls and surface inside. Radar can see them coming',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-16',
    title: 'A living planet, and version numbers',
    notes: [
      'The planet from orbit: sharp coastlines, mountains in relief, deep oceans that catch the sun, drifting clouds, and flora that glows on the night side',
      'Version number on the title screen and in the ⋯ menu, with these release notes',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-11-16',
    title: 'Title screen',
    notes: [
      'The game opens on an animated title over the live planet: Continue, New game, Skirmish, Sound, Editor',
      'Continue shows where your colony is up to and dives down to it from orbit',
      'New game asks twice when you have a colony, so it can’t be lost by a stray tap',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-11-16',
    title: 'Pause means pause',
    notes: [
      'The ore haulers, drone hover, radar dish and bay door stop when the game is paused, and run faster on fast-forward',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-11-16',
    title: 'Online at deeek.org',
    notes: [
      'The game is playable at deeek.org/ExoGenesis',
      'The content editor works there too: commit with a GitHub token, or export your changes as a file',
    ],
  },
  {
    version: '0.6.1',
    date: '2026-11-16',
    title: 'Faster on phones',
    notes: [
      'Resolution adapts to keep the frame rate up; the fps readout shows when it has stepped down',
      'Distant asteroid belts and idle combat effects no longer cost anything on the ground',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-11-16',
    title: 'Sound',
    notes: [
      'Synthesised sound effects for building, mining, combat and alarms, a day/night wind bed, and positional mixing',
      'Sound toggle and volume (behind ⋯ on phones)',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-11-16',
    title: 'Walls, fog of war and faster loading',
    notes: [
      'Walls: drag out a line; predators have to chew through',
      'Rotate buildings before placing them; the ground levels under them',
      'Fog of war: you only see what your buildings, drones and units can see, and radar shows blips beyond',
      'Faster startup: the planet is generated in the background while the rest loads',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-15',
    title: 'Combat units',
    notes: [
      'The Vehicle Bay builds rovers and tanks; tap or drag to select them, tap the ground to send them',
      'A phone-friendly HUD: compact status strip, grid build menu, one-row button bar',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-15',
    title: 'The colony is playable',
    notes: [
      'Build solar arrays, batteries, mining depots and turrets; keep the cryo bank powered through the night',
      'Predator packs attack; goals guide the first sols',
      'Loading screen, and the game autosaves and picks up where you left off',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-15',
    title: 'The editor',
    notes: [
      'Units, buildings and rules live in data files with an in-browser editor',
      'Map editor: sculpt terrain, paint flora and place grazer herds',
      'Asset browser: preview and add models, images and sounds',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-11-15',
    title: 'First landing',
    notes: [
      'One continuous zoom from the landing site out to the whole solar system',
      'Alien flora, and the probe’s landing cinematic',
      'A skirmish prototype with hundreds of units',
    ],
  },
];

/** The running version (package.json, via vite.config.ts). */
export const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : CHANGELOG[0].version;
