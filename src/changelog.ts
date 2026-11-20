/**
 * Release notes, newest first: what players see under "What's new" (title
 * screen and the game menu). Every push to main that changes the game adds an
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
    version: '0.55.0',
    date: '2026-11-20',
    title: 'Smoother controls',
    notes: [
      'Holding W A S D or the arrows now pans smoothly (hold Shift to go faster), and Q E turn smoothly too',
      'The mouse wheel zooms toward what\'s under the pointer (Options can turn it off), and there\'s optional edge scrolling',
      'Right-click sends the selected drone or units, and stops placing a building',
      'F (or Home) glides the camera to whatever you have selected, or back to the Command Core',
      'A drones chip by the resources shows how many are idle: click it, or press ., to jump to the next idle drone',
      'Control groups: Ctrl or Shift + 4 to 9 saves the selected units, the number selects them again, twice looks at them. Ctrl+A selects every combat unit',
      '[ and ] change the game speed; a PAUSED banner shows while you\'re paused (tap it to carry on)',
      'Ctrl+S saves; ? or H (and Controls in the menu) lists every key and gesture',
      'While placing, the reason a building can\'t go somewhere shows right by the cursor',
      'Esc closes the build menu first; the radar map can be dragged across to sweep the camera',
      'Recycle asks for a second tap (showing what you\'ll get back) instead of a browser pop-up',
      'The game pauses when you switch to another tab or app, and tells you when you come back (Options → Pause in the background)',
      'Fixed: selecting units that had only just been made could drop the selection straight away',
    ],
  },
  {
    version: '0.54.0',
    date: '2026-11-20',
    title: 'Computer players',
    notes: [
      'The computer players in a skirmish now play: they build a base (power, depots, a Vehicle Bay, turrets, the geothermal vent, batteries for the night), reach out with Relay Towers to more deposits, research at a Tech Lab, and raise an army',
      'They attack in waves that grow each time, bring reinforcements, fall back when a wave is broken, and pull everyone home when their base is attacked',
      'Easy, Normal and Hard: Easy builds less and attacks late with small waves; Hard thinks faster, builds more, attacks bigger and gets a little extra alloy',
      'Computer players play fair: they see only what their fog of war shows (and where each base started)',
      'In a skirmish there\'s no cryo bank drawing power any more, and each player may have up to 40 combat units',
    ],
  },
  {
    version: '0.53.0',
    date: '2026-11-20',
    title: 'Skirmish setup',
    notes: [
      'SKIRMISH on the title screen now opens a setup: 2 to 4 players, teams (free for all, you against everyone, or 2 v 2), the world, size, sea and ground, a map seed with a live preview of the map, starting alloys, fog of war, wildlife and predator packs',
      'Every player has a colour: their units, the rings under their buildings and drones, the glow of their buildings and their dots on the map',
      'Fog of war hides the other players: their units only while you can see them, their buildings once you have',
      'A skirmish HUD: no cryo bank, colonists or planet health, a game clock, and the map from the start',
      'Win by being the last one standing (or the last team): the end screen shows everyone\'s units built, kills, losses and alloys mined, with Rematch and New skirmish',
      'The menu in a skirmish has Rematch, New skirmish and Surrender',
      'The computer players don\'t play yet: that comes next. The old hundreds-of-units battlefield is still at ?mode=skirmish',
    ],
  },
  {
    version: '0.52.0',
    date: '2026-11-20',
    title: 'Skirmish maps',
    notes: [
      'New skirmish maps are generated from a seed: 2 to 4 bases evenly round the map, each on flat ground with the same deposits, isotope seam and geothermal vent, rich deposits to fight over between them, and a land route from every base to the middle',
      'Pick the world (Home, Verdance, Dunmore, Rime, Cinder, Ash), the size, how much sea and how rough the ground is',
      'Preview for now: the skirmish setup screen comes next. Until then a link starts one, e.g. ?skirmish=42&players=3&world=rime&relief=rugged (no computer players yet)',
    ],
  },
  {
    version: '0.51.0',
    date: '2026-11-20',
    title: 'Sounds of the colony',
    notes: [
      'The title music now plays straight away where your browser allows it; where it doesn\'t, the title tells you to click anywhere for sound (before, only Options would start it)',
      'Big moments have their own sounds: a child born, a colonist lost, research done, a new mission, an objective ticked, a mission won or failed, victory and defeat',
      'And the smaller ones: discoveries, new friendships, a deposit running dry, refunds, messages and story cards',
      'Selecting something and giving an order now sound too',
      'The world is livelier: surf along the shore, drones clanking and welding as they build, wildlife calling, and voices near the camps you\'ve met',
    ],
  },
  {
    version: '0.50.1',
    date: '2026-11-20',
    title: 'Skirmish groundwork',
    notes: [
      'Behind the scenes: the game can now run several players on one map, each with its own base, alloys, power, research and fog of war, fighting each other. This is the first step toward a full skirmish mode against computer players; the campaign plays exactly as before',
    ],
  },
  {
    version: '0.50.0',
    date: '2026-11-20',
    title: 'A tidier screen',
    notes: [
      'The bottom bar is down to Build, speed, the three views and ☰ Menu',
      'Menu (☰, or Esc with nothing selected) pauses the game and holds Save, Load, Options, What\'s new, Skirmish, the title screen and New game (which asks twice)',
      'Options now has the sound and music volume sliders, the terrain look (Flat or Smooth) and Performance stats',
      'The frame rate and altitude box is hidden unless you turn on Performance stats, and the radar moves up into its place',
      'Resource counters that don\'t apply yet (no Battery Bank, no isotopes, no radar, no army) stay hidden until they do',
    ],
  },
  {
    version: '0.49.1',
    date: '2026-11-20',
    title: 'Units find their way round buildings',
    notes: [
      'Units sent the long way round a base no longer give up partway: they now judge progress by the road left to go, not the straight-line distance',
      'Sent somewhere walled off or into a building, units go as close as they can get and stop there instead of milling about',
      'A group ordered onto a building spreads out on open ground beside it instead of piling up at one spot',
      'Fast units (Scouts, Rovers) slow into sharp turns, so they stop circling round corners and waypoints',
    ],
  },
  {
    version: '0.49.0',
    date: '2026-11-20',
    title: 'Import music',
    notes: [
      'Editor: Import in Rules → Music adds a mood from JSON (paste it or choose a .json file). It\'s checked first: it lists any problems (a note that isn\'t a note, an unknown field) and fills in anything missing',
      'Editor: Copy JSON on a mood copies it, unsaved changes and all, to share or bring back in',
    ],
  },
  {
    version: '0.48.0',
    date: '2026-11-20',
    title: 'Outer Dark',
    notes: [
      'A new night piece, Outer Dark: slow strings and hushed voices in five, distant booms and a heartbeat, far-off calls, and a flute that comes in later',
      'Smoother when a fight starts: changing music no longer causes a brief stutter',
      'Longer sounds (big explosions, heavy shots, booming drums) no longer cut off early with a click',
      'Turning the music volume to zero now stops the music completely, saving a little battery',
    ],
  },
  {
    version: '0.47.0',
    date: '2026-11-19',
    title: 'A wider soundtrack',
    notes: [
      'Five new pieces of music, each unlike anything before it, and new instruments: guitar, harp, marimba, thumb piano, electric piano, organ, brass, war drums, hand drums and more',
      'Day: Prospector, a frontier tune with fingerpicked guitar, hand drum and tin whistle; and Fabricator, a ticking, interlocking machine piece in five',
      'Night: Transmission, a crackly late-night jazz broadcast from home',
      'Fights: Warpath, thundering war drums and brass; and Interference, a glitchy, distorted electronic piece in seven',
      'Music can now build and break down as it plays, with parts coming in and dropping out, so a piece changes over its length',
    ],
  },
  {
    version: '0.46.0',
    date: '2026-11-19',
    title: 'New sounds',
    notes: [
      'Eight new pieces of music in four new styles',
      'Electronic: Relay, a pulsing synth arpeggio and bassline for the day, and Grid Fault, fast and driving for fights',
      'Melodic: Homestead, a gentle flute tune for the day, and Lantern, a music-box lullaby for the night',
      'Cinematic: Accord, strings and a wordless choir, a second theme for the title screen; and Vigil, hushed voices at night',
      'Alien: Other Voices, sliding, warbling chords and strange calls in the dark; and Hive, a chattering, unsettled fight',
    ],
  },
  {
    version: '0.45.0',
    date: '2026-11-19',
    title: 'More music',
    notes: [
      'Six new pieces of music, two each for day, night and fights, so the soundtrack has more variety. You won\'t hear the same one twice in a row',
      'Day: Survey, a light, moving piece with plucked runs and a gentle shaker groove; and Wide Sky, slow and open with glassy chords and far-off drums',
      'Night: Deep Watch, low and brooding with a distant boom; and Starfield, dreamy, with twinkling bells and a faint ticking beat',
      'Fights: Siege, fast and driving with full drums; and Stalker, slow and creepy, with a ticking clock and a heartbeat',
    ],
  },
  {
    version: '0.44.0',
    date: '2026-11-19',
    title: 'Drums in the dark',
    notes: [
      'The tension music now has percussion: a heavy, slow beat with distant booms, low toms, a metallic clank and a rattling shaker that drift against each other when a fight breaks out',
    ],
  },
  {
    version: '0.43.0',
    date: '2026-11-19',
    title: 'Wildlife and plants, remodelled',
    notes: [
      'All seven wildlife body types have detailed new models: plated grazers, beaked stilt-walkers, hoppers with glowing feelers, gliders with swept wings and whip tails, armoured crawlers, shelled plodders and banded snakes',
      'The new plants are remodelled too: canopy trees with hanging glow fruit, tendrils with glowing suckers, reeds with seed heads, spotted mushroom clusters, cacti with flowering arms, thorn scrub and lichen crusts',
      'Every species still wears its own colours, and performance stays the same',
    ],
  },
  {
    version: '0.42.0',
    date: '2026-11-19',
    title: 'Music for the long view',
    notes: [
      'Music: quiet, slow ambient that never plays the same way twice. The title screen has its own, drifting through soft chords and distant bells while the camera tours the system',
      'In play, music comes in now and then: a warm daytime piece and a sparse, darker one at night, with long stretches of just the wind between',
      'When a fight breaks out the music turns tense, with a low heartbeat pulse, and settles again once it is over',
      'Music has its own volume (the ♫ slider next to Sound) and its own switch in Options',
      'Shots, deaths and their sounds no longer go missing when the game runs slowly or at ×3 speed',
      'The region list in Options shows which world each region is on',
    ],
  },
  {
    version: '0.41.0',
    date: '2026-11-19',
    title: 'Living worlds',
    notes: [
      'Every world has its own plants and wildlife: lush forests and reed beds, dry scrub and barrel succulents in the deserts, frost ferns and ice prisms on frozen worlds, vent chimneys and ember-glowing ash caps on volcanic ones, and only lichen and crystals on airless rock',
      'Seven new plant forms: broad canopy trees, giant curling tendrils, reeds, mushroom caps, barrel succulents, thorn scrub and lichen',
      '23 wildlife species with their own sizes and habits: herds that bolt, skittish hoppers that dart and pause, huge plodders that stop and stare, gliders circling overhead, and burrowers that duck underground when you come close',
      'Home has new neighbours too: Skippers, towering Stiltwalkers and Driftkites share the plains with the grazers',
      'Wildlife eyes and markings glow at night like the plants',
    ],
  },
  {
    version: '0.40.1',
    date: '2026-11-19',
    title: 'A tidier title screen',
    notes: [
      'Region and Sound have moved into Options on the title screen. Regions are now a list: tap the one you want to land in',
    ],
  },
  {
    version: '0.40.0',
    date: '2026-11-19',
    title: 'Worlds up close',
    notes: [
      'The other worlds in the system have detailed surfaces, sharp at any distance: cratered moons with rays, rims and central peaks, icy moons cut by long fractures, a molten world with glowing seams, a sulfur moon spotted with calderas, wind-streaked deserts and frosted poles',
      'Gas giants have turbulent bands, great storms and scattered white ovals, and drift slowly; their rings show ringlets and gaps',
      'Worlds with clouds keep them when you see them from afar',
    ],
  },
  {
    version: '0.39.0',
    date: '2026-11-19',
    title: 'New ground',
    notes: [
      'Seven new regions to land in (REGION on the title screen): The Ridgeback, a spine of rock with two passes and a sleeping relic grid; Hearthsmoke Vale, the green heartland of the Vell; The Choir Field, a dead levelled plain round the Choir\'s pylon; Burrow Reach, burrower country with furrows too straight to be natural; Splinter Hollow, a quiet basin with one way in; The Deep Layer, a crater of stacked ruins and the richest caches yet; and Signal Heights, a snowbound plateau in the far north',
      'Each has its own threats: from a long, quiet start in Splinter Hollow to big packs, nests and guarded relics in Burrow Reach and The Deep Layer',
    ],
  },
  {
    version: '0.38.0',
    date: '2026-11-19',
    title: 'Care and remembrance',
    notes: [
      'New: the Med Bay. Anyone lying injured within its reach stops getting worse, and its stretcher crews bring them in one at a time, fully healed (medics on staff make it quicker). Homes near it get medical care, and the people living there live longer',
      'The Medevac now takes the injured to a Med Bay when there is one not much further away than the nearest home',
      'New: the Memorial, a ring of stones carved with the names of everyone the colony has lost, round a flame that never goes out. Homes near it take comfort from it, and grief fades faster while it stands. Select it to read the names',
    ],
  },
  {
    version: '0.37.0',
    date: '2026-11-19',
    title: 'Shelter and stewardship',
    notes: [
      'New research at the Tech Lab: Shield Lattice (after Deep Survey)',
      'New: the Shield Projector, which throws a dome over everything near it. The dome stops bites, spit and claws from outside until it has soaked its fill, then collapses and comes back at 30%. Predators that get inside are under it with you. It draws heavy power all the time',
      'New: the Aegis Crawler, a slow unarmed tracked shield generator whose bubble covers whatever is parked round it',
      'Planet health (🌍 in the top bar): strip mining, burnt-out buildings and nest sites scar the land and lower it, and wiping out nests or driving the inhabitants off harms it for good. A Biosphere Report sends it home at the end of every sol',
      'New: the Seed Bank, which heals scarred land around it with surplus biomass (never your food reserve) and, with nothing left to heal, rewilds',
      'When a building falls, the people inside are left lying injured by the ruins, with about a minute to live',
      'New: the Medevac, a fast ambulance from the Vehicle Bay that picks up the injured (four at a time) and brings them in to the nearest home',
    ],
  },
  {
    version: '0.36.2',
    date: '2026-11-18',
    title: 'Drones, up close',
    notes: [
      'Worker drones and ore haulers get a detailed model: four ducted rotors, a visor and a folded work arm',
      'The Arc Caster\'s model is lighter to draw, with the same look',
    ],
  },
  {
    version: '0.36.1',
    date: '2026-11-18',
    title: 'Sea and sky, up close',
    notes: [
      'New detailed models for the Shipyard, Tidal Generator, Pier, Sea Turret, Airpad and Flak Tower',
      'New detailed models for the Hover Skiff, Gunboat, Transport Barge and Gunship, and for the Strider, Lurker and Skimmerwing',
    ],
  },
  {
    version: '0.36.0',
    date: '2026-11-18',
    title: 'Wings',
    notes: [
      'New: the Airpad, a landing pad that builds flyers (and only flyers)',
      'New: the Gunship, a twin-rotor flyer that crosses water, walls and buildings in a straight line and strafes packs from above, out of reach of bites. It can\'t shoot at other flyers',
      'New predator: the Skimmerwing, a flying pack hunter that joins the later packs and flies straight over your walls',
      'Only anti-air weapons can hit flyers: the Command Core\'s gun, Point Defense and the Arc Caster. Everything else ignores them, so mix your defences',
      'New: the Flak Tower, anti-air guns whose bursts catch whole flocks of flyers. It never fires at anything on the ground',
      'Spitters can now spit up at flyers',
      'Flyers cruise high above the ground, bank into their turns and cast a shadow below them',
    ],
  },
  {
    version: '0.35.0',
    date: '2026-11-18',
    title: 'Boats and the shore',
    notes: [
      'New: the Shipyard, built across the waterline. It launches Gunboats (armoured boats with a deck cannon) and Hover Skiffs',
      'New: the Tidal Generator, steady power from a platform out on the water',
      'New: the Sea Turret, a Defense Turret out on the water that nothing on foot can reach',
      'New: the Pier, a deck out over the water that lets you build across a bay',
      'New: the Transport Barge carries four ground units across the water. Select them and tap the barge to load, then order the barge to a spot on land and it puts them ashore',
      'New predator: the Lurker, a sea creature that comes with packs whose spawn is near water and strikes at anything by the shore',
      'Predators no longer get stuck on the beach trying to reach something on an island or out on the water; they go for what they can reach',
      'Faster: the colony simulation does about half the work it did in big fights (smoother on phones, especially at ×3), and placing a building no longer causes a brief stutter',
      'Units no longer get pushed into the water when they crowd together on a beach',
    ],
  },
  {
    version: '0.34.0',
    date: '2026-11-18',
    title: 'Hover craft and waders',
    notes: [
      'New: the Hover Skiff, a fast gun platform on an air skirt that crosses water as easily as land (Vehicle Bay)',
      'The Scout Skimmer now skims over water too',
      'New predator: the Strider, a long-legged wader that walks straight through water and joins the later packs',
      'Predators now find their way round lakes and bays instead of getting stuck on the shore',
      'Wide shallow flats no longer turn white with foam',
    ],
  },
  {
    version: '0.33.0',
    date: '2026-11-18',
    title: 'Water',
    notes: [
      'Seas are real water now: rippling and glinting in the sun, mirroring the sky, clear in the shallows where you can see the sea floor and deep blue further out',
      'Foam laps onto beaches and the water line follows the shore smoothly instead of in blocks',
      'Phones get a lighter version with calmer ripples and a still shoreline; Options → Detailed water switches between the two',
    ],
  },
  {
    version: '0.32.0',
    date: '2026-11-18',
    title: 'Glow, shadows and printed construction',
    notes: [
      'Glow: lights, glowing strips and gunfire now spill soft light, strongest at night (on by default on computers, off on phones)',
      'Buildings, drones, vehicles and creatures cast soft shadows on the ground that follow the sun, long at dawn and dusk',
      'New buildings print from the ground up: solid below a glowing cyan line, a wireframe above it, with sparks along the line',
      'Options on the title screen (and ⚙ Options in the ⋯ menu) turn glow, shadows, printed construction and colony lights on or off, and remember your choice',
    ],
  },
  {
    version: '0.31.0',
    date: '2026-11-18',
    title: 'Story tools',
    notes: [
      'Story moments can now change the game itself: call in creatures or reinforcements, hold back buildings until their moment, start countdowns, mark places to visit, move your view, and end the game in victory or defeat',
      'Missions can now be failed, and the countdowns you are racing show under your goals',
      'Tutorial hints can point straight at the button or building you need, and go away once you have used it',
      'Regions can hold placed creatures that guard a spot or walk a patrol, some of which only turn up as the story unfolds',
      'Editor: a story inspector in play tests (fire events, tick objectives, set flags and counters, skip time), with story edits applied to the running game as you save them',
      'Editor: Playthrough has the bot play the campaign and lists events that never fired, choices nobody took and missions that never finished',
      'Editor: Script import turns a screenplay into story events or a cinematic\'s lines; Branch graph and Endings ledger show how the story links up and what each choice moves',
      'Editor: map encounters, a status and comments on story records, and Checks → To do with what\'s missing and a voice script for every character',
    ],
  },
  {
    version: '0.30.0',
    date: '2026-11-18',
    title: 'Coasts',
    notes: [
      'Regions can now sit on the coast with real sea in them, instead of always being raised onto dry land',
      'Editor: a region\'s new Keep the sea option (map editor, Place on the body) leaves the world\'s seas and coastline as they are round the region; the Core\'s landing pad stays dry, and sculpting below sea level makes more water',
    ],
  },
  {
    version: '0.29.1',
    date: '2026-11-18',
    title: 'Library fill-in',
    notes: [
      'Editor: the Civilian Center and Hydroponics built-in models are now in the asset library, so every Blender model has its procedural twin there to compare against or export',
    ],
  },
  {
    version: '0.29.0',
    date: '2026-11-18',
    title: 'Other worlds',
    notes: [
      'Regions can now be on any planet, moon, asteroid or comet in the system: land on one and that world becomes yours, with its own size, ground, colours and sky (airless worlds have a black one), and the rest of the system turning round it',
      'Regions come in sizes from small to twice as wide as before',
      'Inhabitant camps and their people switch to simpler models when you zoom out, so busy maps stay smooth',
      'Editor: Maps → Worlds edits every planet, moon, asteroid and comet (terrain, colours, atmosphere, orbit, rings) with a turning preview and an orbit map; the Planet map works per world and starts new regions where you click',
      'Editor: the map editor paints the ground\'s colour, generates landforms (hills, ridges, craters, mesas, dunes, basins, plateaus, canyons), auto-paints by height and slope, and resizes a region',
      'Editor: cinematics are much quicker to make: fly the preview camera and add a key from the view, add captions, lines and sounds at the playhead, edit text in place, delete, copy and nudge with the keyboard, zoom the timeline, see the camera\'s path from above, and turn on framing guides',
      'Editor: Story → Story board lays out missions, events, cinematics, characters, inhabitants and a new story bible by chapter, with tags, writer\'s notes and filters; drag a card to move it to another chapter',
    ],
  },
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
