/**
 * ENGINEERING FIXTURE — "City Center Stadium", Level 2 concourse. Not a real venue. Used for tests,
 * the demo console, and the pack-pipeline fixture. Metres east/north from the venue origin.
 *
 * Layout: two rows of concourse rooms either side of an east–west walkway; three exits; two
 * stairwells; AEDs; first aid; an assembly point outside Exit C.
 */
import { amenity, floor, opening, path, rect, unit, walkway } from './builders.js';

export const CITY_CENTER_L2 = floor([
  unit('201', 'Concourse 201', rect(-60, 6, 34, 26)),
  unit('204', 'Concourse 204', rect(-18, 6, 38, 26)),
  unit('207', 'Concourse 207', rect(26, 6, 34, 26)),
  unit('west', 'West Hall', rect(-60, -32, 30, 26)),
  unit('main', 'Main Concourse', rect(-18, -32, 38, 26)),
  unit('east', 'East Hall', rect(26, -32, 34, 26)),
  walkway('walkway', 'Concourse Walkway', rect(-64, -6, 128, 12)),
  path('spine', [
    [-64, 0],
    [-43, 0],
    [-22, 0],
    [1, 0],
    [22, 0],
    [43, 0],
    [62, 0],
  ]),
  opening('d201', '201', [-43, 6]),
  opening('d204', '204', [1, 6]),
  opening('d207', '207', [43, 6]),
  opening('dwest', 'west', [-43, -6]),
  opening('dmain', 'main', [1, -6]),
  opening('deast', 'east', [43, -6]),
  amenity('exitA', 'exit', 'Exit A', [-64, 24]),
  amenity('exitB', 'exit', 'Exit B', [-64, -28], { accessible: false }),
  amenity('exitC', 'exit', 'Exit C', [62, -2]),
  amenity('stairB', 'stairwell', 'Stairwell B', [-24, -4]),
  amenity('stairC', 'stairwell', 'Stairwell C', [34, 12]),
  amenity('aed1', 'aed', 'AED — West', [-22, 16]),
  amenity('aed2', 'aed', 'AED — East', [22, -14]),
  amenity('ext1', 'fire_extinguisher', 'Extinguisher 204', [-10, 5]),
  amenity('firstAid', 'first_aid', 'First Aid', [2, -30]),
  amenity('assembly', 'assembly', 'Assembly Point', [52, -30]),
  amenity('cp201', 'checkpoint', 'Checkpoint 201 door', [-43, 7]),
  amenity('cp204', 'checkpoint', 'Checkpoint 204 door', [1, 7]),
  amenity('cpMain', 'checkpoint', 'Checkpoint Main Concourse', [1, -7]),
  amenity('cpEast', 'checkpoint', 'Checkpoint East Hall', [43, -7]),
  amenity('youHere', 'you_are_here', 'You Are Here', [-2, -14]),
]);

/** Ground level: gates and a ring concourse, so the level switcher swaps real geometry. */
export const CITY_CENTER_GROUND = floor([
  unit('gateA', 'Gate A Lobby', rect(-60, 6, 30, 22)),
  unit('gateB', 'Gate B Lobby', rect(30, 6, 30, 22)),
  unit('retail', 'Retail Plaza', rect(-24, 6, 48, 22)),
  unit('ops', 'Operations', rect(-60, -30, 40, 22), 'restricted'),
  unit('medical', 'Medical Suite', rect(-14, -30, 28, 22)),
  unit('south', 'South Hall', rect(20, -30, 40, 22)),
  walkway('ring', 'Ground Concourse', rect(-64, -8, 128, 14)),
  path('ring-spine', [
    [-64, 0],
    [-45, 0],
    [-20, 0],
    [0, 0],
    [20, 0],
    [45, 0],
    [62, 0],
  ]),
  opening('dGateA', 'gateA', [-45, 6]),
  opening('dRetail', 'retail', [0, 6]),
  opening('dGateB', 'gateB', [45, 6]),
  opening('dOps', 'ops', [-45, -8]),
  opening('dMed', 'medical', [0, -8]),
  opening('dSouth', 'south', [45, -8]),
  amenity('exitG-A', 'exit', 'Gate A', [-64, 14]),
  amenity('exitG-B', 'exit', 'Gate B', [62, 14]),
  amenity('exitG-S', 'exit', 'South Exit', [62, -6]),
  amenity('stairG1', 'stairwell', 'Stair 1', [-22, -2]),
  amenity('stairG2', 'stairwell', 'Stair 2', [34, 8]),
  amenity('aedG', 'aed', 'AED — Medical Suite', [2, -12]),
  amenity('firstAidG', 'first_aid', 'Medical Suite', [0, -20]),
  amenity('assemblyG', 'assembly', 'Plaza Assembly', [70, 20]),
  amenity('youHereG', 'you_are_here', 'You Are Here', [-30, 12]),
]);

export const CITY_CENTER_LEVELS = [
  { id: 'ground', name: 'Ground', ordinal: 0 },
  { id: 'level-2', name: 'Level 2', ordinal: 1 },
] as const;

export const CITY_CENTER_FLOORS: Record<string, typeof CITY_CENTER_L2> = {
  Ground: CITY_CENTER_GROUND,
  'Level 2': CITY_CENTER_L2,
};
