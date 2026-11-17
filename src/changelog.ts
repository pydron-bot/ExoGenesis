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
    version: '0.15.0',
    date: '2026-11-17',
    title: 'New regions',
    notes: [
      'Maps made in the editor are now playable: when there is more than one region, the title screen has a REGION choice and NEW GAME lands there',
      'CONTINUE always takes you back to the region your colony is in',
      'Each region can sit anywhere on the planet, with its own ground, and can set its own pack size, grace period, time between packs and starting alloys',
      'Editor: ▶ Play this region opens a fresh test game on the map you are editing, unsaved changes included, without touching your colony',
    ],
  },
  {
    version: '0.14.0',
    date: '2026-11-17',
    title: 'Health bars, smoother big battles',
    notes: [
      'Health bars over damaged units, yours and the predators\' (and over any unit you select)',
      'Big battles run much smoother: zoomed out, vehicles and predators switch to simpler models; zoom in and the detailed ones come back',
    ],
  },
  {
    version: '0.13.0',
    date: '2026-11-16',
    title: 'Lights, new models, night battles',
    notes: [
      'Colony lights are on for everyone: floodlights, headlights, gunfire and explosions light up the ground at night, and nights are darker. Turn them off under ⋯ → ✦ Lights',
      'New, more detailed models for every building (except the Command Core), every vehicle and every predator',
      'Turrets, point defense, siege cannons and radars cost far less to draw, so heavily defended bases stay smooth',
      'Skirmish: a ☀ Day / ☾ Night button (or the N key) to fight at noon or at midnight',
    ],
  },
  {
    version: '0.12.4',
    date: '2026-11-16',
    title: 'Colony lights (experimental)',
    notes: [
      'Experimental: add ?lights=1 to the address to try colony lighting. Floodlights, headlights, muzzle flashes and explosions light up the ground at night, and nights get darker',
    ],
  },
  {
    version: '0.12.3',
    date: '2026-11-16',
    title: 'Smoother big bases, part 2',
    notes: [
      'Gates, Hydroponics and Battery Banks now cost far less to draw too, so sprawling colonies stay smooth',
    ],
  },
  {
    version: '0.12.2',
    date: '2026-11-16',
    title: 'Smoother big bases',
    notes: [
      'Long walls and solar fields cost far less to draw, so large colonies stay smoother, especially on phones',
    ],
  },
  {
    version: '0.12.1',
    date: '2026-11-16',
    title: 'Home screen app fits the screen',
    notes: [
      'On iPhone, the installed app now fills the whole screen: no more empty strip under the buttons at the bottom',
      'The top bar sits a little lower in the installed app, clear of the status bar',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-11-16',
    title: 'Install it on your phone',
    notes: [
      'Add Exo Genesis to your home screen (iPhone: Share → Add to Home Screen; Android: ⋮ → Install app). It gets its own icon and opens full-screen',
      'Once you have played it once, it starts and plays without a connection. New versions still arrive as soon as you are back online',
    ],
  },
  {
    version: '0.11.0',
    date: '2026-11-16',
    title: 'More units, more buildings, new predators',
    notes: [
      'Four new vehicles at the Vehicle Bay: the fast Scout Skimmer that sees far, the Field Engineer that repairs units and buildings in the field, the Arc Caster whose discharge jumps between targets, and long-range Artillery (it needs something to spot for it)',
      'New defenses: Point Defense for anything that reaches the base, and the Siege Cannon that shells from far out',
      'Gates: drop one onto a wall and it slots in. Your units drive through, predators can\'t',
      'Repair Pad: park damaged units on it to mend them for free while it has power',
      'Geothermal vents glow in the ground. Build a Geothermal Tap on one for steady power all night',
      'New predators in later packs: Spitters attack from just beyond a Defense Turret\'s reach, and Burrowers tunnel under your walls and surface inside. Radar can see them coming',
      'Rotating the view by right-dragging (or shift-dragging) left and right now turns it the other way. Touch is unchanged',
      'Dragging from a unit to order it no longer turns into "select all of this type" when the game is running slowly',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-11-16',
    title: 'People',
    notes: [
      'The cryo bank now holds 120 embryos from 24 family lines. Let it run warm (below 50% integrity) and embryos die',
      'New buildings: Hydroponics grows biomass (food), and the Civilian Center houses colonists and runs growth pods',
      'Grow colonists: choose their specialty and what the AI teaches them (Charter, Heritage or Unity). A pod needs power and food for a whole sol, or the child inside is lost',
      'Colonists are named, age (one sol is one year), live and work in your buildings, walk the base, and run for cover when predators come. Staffed buildings work better',
      'Everyone has two meters: wellbeing, and how far they accept the AI. They form blocs (Partners, Autonomists, Devoted) that want different things',
      'Set work hours, rations, oversight and who runs the council from the new Colony panel (tap 👤). Unhappy colonists strike or sabotage, an angry Autonomist majority can walk out, and a colony in step with its AI gets Breakthroughs',
      'Couples have children, lineages can die out, and the Memorial remembers everyone lost',
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
