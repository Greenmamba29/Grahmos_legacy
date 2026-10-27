/**
 * ENGINEERING FIXTURE — "Harbor General Hospital", Wing 3 (Level 2). Not a real facility.
 *
 * Three smoke compartments (A | B | C) split by rated barriers at x = -24 and x = 24, each with an
 * area of refuge. One east–west corridor spine crosses each barrier once. This is the floor that
 * exercises horizontal evacuation.
 */
import { amenity, compartment, floor, opening, path, rect, unit, walkway } from './builders.js';

export const HARBOR_GENERAL_W3 = floor([
  compartment('A', 'Compartment A', rect(-72, -36, 48, 72)),
  compartment('B', 'Compartment B', rect(-24, -36, 48, 72)),
  compartment('C', 'Compartment C', rect(24, -36, 48, 72)),

  unit('icu1', 'ICU 301', rect(-70, 6, 20, 26)),
  unit('icu2', 'ICU 302', rect(-48, 6, 22, 26)),
  unit('refA', 'Refuge A', rect(-70, -32, 44, 24), 'refuge'),
  unit('nurse', 'Nurse Station', rect(-22, 6, 20, 26)),
  unit('imaging', 'Imaging', rect(0, 6, 22, 26)),
  unit('refB', 'Refuge B', rect(-22, -32, 44, 24), 'refuge'),
  unit('ward1', 'Ward 310', rect(26, 6, 20, 26)),
  unit('ward2', 'Ward 311', rect(48, 6, 22, 26)),
  unit('refC', 'Refuge C', rect(26, -32, 44, 24), 'refuge'),
  walkway('corridor', 'Wing 3 Corridor', rect(-72, -6, 144, 12)),
  path('spine', [
    [-72, 0],
    [-60, 0],
    [-37, 0],
    [-24, 0],
    [-12, 0],
    [11, 0],
    [24, 0],
    [36, 0],
    [59, 0],
    [72, 0],
  ]),
  opening('dIcu1', 'icu1', [-60, 6]),
  opening('dIcu2', 'icu2', [-37, 6]),
  opening('dRefA', 'refA', [-48, -8]),
  opening('dNurse', 'nurse', [-12, 6]),
  opening('dImaging', 'imaging', [11, 6]),
  opening('dRefB', 'refB', [0, -8]),
  opening('dWard1', 'ward1', [36, 6]),
  opening('dWard2', 'ward2', [59, 6]),
  opening('dRefC', 'refC', [48, -8]),

  amenity('exitW', 'exit', 'West Stair Exit', [-72, 4], { accessible: false }),
  amenity('exitE', 'exit', 'East Exit', [72, 4]),
  amenity('stairW', 'stairwell', 'Stair W', [-66, -3]),
  amenity('stairE', 'stairwell', 'Stair E', [66, -3]),
  amenity('refugeA', 'refuge', 'Refuge A', [-48, -20]),
  amenity('refugeB', 'refuge', 'Refuge B', [0, -20]),
  amenity('refugeC', 'refuge', 'Refuge C', [48, -20]),
  amenity('aedN', 'aed', 'AED — Nurse Station', [-14, 10]),
  amenity('aedW2', 'aed', 'AED — Ward 311', [50, 10]),
  amenity('extA', 'fire_extinguisher', 'Extinguisher A', [-40, 5]),
  amenity('youHereH', 'you_are_here', 'You Are Here', [-55, 18]),
]);
