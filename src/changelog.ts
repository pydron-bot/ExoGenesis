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
    version: '0.28.1',
    date: '2026-11-18',
    title: 'Lighter from afar',
    notes: [
      'Zoomed out, buildings, wrecks and relic caches switch to simpler built-in models, like units already do (and they show those while their detailed models load)',
      'The new buildings, the Lancer and the relic sentinel have proper zoomed-out looks of their own',
    ],
  },
  {
    version: '0.28.0',
    date: '2026-11-18',
    title: 'The relic grid',
    notes: [
      'North of the landing site, a ring of carved stones is a precursor defense grid. It sleeps until something of ours comes close, then scans us, and only half of it stands down',
      'Grid Nodes power the grid: destroy every node and it shuts off and opens its cache (alloys and isotopes). Lancers outrange the sentinels',
      'New research, Relic Studies: a Field Engineer parked next to a Grid Node re-tunes it instead, no fight needed',
      'Two new story beats: Handshake and Deep Layer',
    ],
  },
  {
    version: '0.27.0',
    date: '2026-11-18',
    title: 'Research and isotopes',
    notes: [
      'Tech Lab: select it to research, one project at a time. Technicians working there speed it up',
      'Exotic isotopes (◇): research Deep Survey, then put a Deep-Core Mine on one of the glowing violet seams. Touchdown has two, out past the build area, so a Relay Tower helps. The drill is loud: packs go for it first',
      'Fusion Cell (research Isotope Cells): 16 MW day and night, as long as it has isotopes to burn',
      'Building the Tech Lab sets off a new story beat',
    ],
  },
  {
    version: '0.26.0',
    date: '2026-11-18',
    title: 'Nests and wrecks',
    notes: [
      'Every predator spawn now has a Nest. Packs only come from spawns whose nest stands: send an army to destroy one and that side goes quiet for ten minutes before it grows back. Hurt nests let out their guards',
      'Wrecks: two broken landers lie out on Touchdown. Scouts find them; park a Field Engineer next to one and it strips the hull for alloys. They are built a lot like ours',
      'Far away, Lancers now look like Lancers instead of Rovers',
    ],
  },
  {
    version: '0.25.0',
    date: '2026-11-18',
    title: 'New arrivals',
    notes: [
      'Lancer (Vehicle Bay): a slow rail-lance tank that hits one target very hard from far away. The answer to Brutes; wasted on swarms',
      'Sensor Mast: a cheap tripod of cameras that clears the fog around it. Put them along mining lines and at gaps in your walls',
      'Habitat Block: housing for six more colonists, no growth pods, so the colony can grow past the Civilian Center',
      'Relay Tower: you can build anywhere within its range, so a far deposit or vent no longer needs a chain of buildings',
    ],
  },
  {
    version: '0.24.1',
    date: '2026-11-18',
    title: 'Smoother worlds',
    notes: ['The other planets and moons are smooth-shaded and rounder up close, so the title tour looks its best'],
  },
  {
    version: '0.24.0',
    date: '2026-11-18',
    title: 'Grand tour',
    notes: ['Leave the title screen open and the camera sets off on a tour of the system: it flies out to the other planets and moons, settles into orbit over each one, and now and then comes home'],
  },
  {
    version: '0.23.1',
    date: '2026-11-18',
    title: 'Title fix',
    notes: ['The EXO GENESIS title no longer cuts off its last letter on iPad: it shrinks to fit the screen'],
  },
  {
    version: '0.23.0',
    date: '2026-11-18',
    title: 'Editor preview',
    notes: [
      'Editor: a cinematic plays in a small preview right above its timeline (the camera, titles and lines over the real ground), so you can try it without opening the game',
      'Editor: the sidebar and the details panel fold away to give the middle more room (the edge buttons, or [ and ])',
    ],
  },
  {
    version: '0.22.0',
    date: '2026-11-17',
    title: 'Cinematics',
    notes: [
      'Story moments can now play as short cinematics: the camera moves over your colony, with titles, spoken lines, sound and music, while the game waits for you (Esc or Skip to skip)',
      'The opening landing plays just as before',
      'Editor: Cinematics holds the landing and any cinematics you add, each with a timeline of camera moves, captions, lines and sounds. One plays when its trigger is met, or from a story event or mission reward, and ▶ Play shows it in the game',
    ],
  },
  {
    version: '0.21.0',
    date: '2026-11-17',
    title: 'Tidier editor',
    notes: [
      'Editor: the sidebar\'s group headings stand out, stay in view as you scroll, and fold away with a click (remembered in your browser)',
    ],
  },
  {
    version: '0.20.1',
    date: '2026-11-17',
    title: 'Lighter updates',
    notes: [
      'Updates download much less: the 3D engine is kept between releases instead of being fetched again, and so is any other part of the game that did not change',
    ],
  },
  {
    version: '0.20.0',
    date: '2026-11-17',
    title: 'Voices',
    notes: [
      'Story cards show who is speaking: the Director and your first colonist have their own names and colours',
      'Your first colonist is called by name when they speak to you',
      'Story moments can be conversations, one line at a time, and short radio messages now arrive in the corner without stopping play (they stay in the log)',
      'Editor: undo and redo in every form, Rename (everything that refers to it follows) and Compare two records side by side',
      'Editor: Checks lists every content problem, a Text page for a spelling pass over every word players read, and what changed since the last release',
      'Editor: map overlays (where you can build, distance rings, the way predator packs walk in) and copy and paste of map areas, even between regions',
      'Editor: a Planet map to place regions, and balance test runs on the Balance page',
      'Editor: play tests can start further in: a later Sol, buildings, colonists, alloys and story flags',
      'Editor: Characters, conversations and radio messages for story events, and triggers for the first colonist\'s age and the colony\'s trust in you',
      'Editor: a timeline for the landing cinematic (beats, camera, captions), and Interface settings for the HUD\'s colours, size and log',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-11-17',
    title: 'Missions',
    notes: [
      'The goals list is now a run of missions: Touchdown, Groundwork, First Night, Firstborn and Beyond the Ridge. The GOALS panel shows the one under way',
      'Finishing a mission can pay a reward, and the next one starts straight away',
      'Beyond the Ridge sends you out to the carved stone and the smoke in the north-west',
      'Editor: Missions (Story group) with objectives, rewards and events at the start and end, a summary and a play test',
      'Editor: Story flow shows how missions, events, choices and flags link up, and flags anything that can never happen',
      'Editor: a Balance table to compare units and buildings, search across all content ( / ), "Used by" for every record, and Review to see what Commit will save',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-11-17',
    title: 'Story events',
    notes: [
      'The story begins: a briefing from Mission Control when you land, a warning as the first night falls, and more as the colony grows',
      'Something is carved on the ridge east of the landing site. Send a drone to look',
      'Your first colonist will have a question for you, and how you answer matters',
      'Some story moments ask you to choose. Your answers can change how colonists feel about the AI',
      'Editor: new Story events (Story group). Pick a trigger, write the card and its choices, add effects, see a live preview and play-test it straight away. Region maps get story sites',
      'Editor: lists like choices and effects are now edited right in the form, and fields show only when they apply',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-11-17',
    title: 'Smoke on the horizon',
    notes: [
      'You are not alone: the Vell live in a camp of stilt huts in the far north-west of Touchdown, past the rich alloy deposit',
      'When your drones or buildings first see them, choose what to do: approach them, keep away, or drive them off',
      'Their regard for the colony drops while your buildings stand on their land and recovers when you leave it alone. If it reaches zero, they leave',
      'Approach them and leave their land alone, and they may come to trust you. Then they warn you of predator packs and share what they see',
      'The Colony panel has a Neighbours tab once you have met them. You can\'t build on their camp',
      'Editor: new Inhabitants records (Story group) with their models, numbers and story text, and an Add camp tool on region maps',
    ],
  },
  {
    version: '0.16.1',
    date: '2026-11-17',
    title: 'Clearer names',
    notes: [
      'The AI-led growth pod imprint is now called Guardian (it was Unity)',
      'Leading-bloc boosts renamed: Partners give Symbiosis (was Accord) and the Devoted give Vigil (was Unity). Autonomists still give Wardens',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-11-17',
    title: 'Who leads the colony',
    notes: [
      'When half your adults (at least 4) are in one bloc, that bloc leads the colony and gives a boost. The Colony panel shows who leads and what each boost does',
      'Autonomists · Wardens: colonists fight off predators from the buildings they shelter in, and take half the harm outdoors',
      'Partners · Accord: colonists at work add 50% more to their buildings',
      'Devoted · Unity: drones build and repair 30% faster, and buildings draw 15% less power',
    ],
  },
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
