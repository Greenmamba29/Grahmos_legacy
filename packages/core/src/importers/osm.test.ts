import { describe, expect, it } from 'vitest';
import { osmToFloor, parseOsm } from './osm.js';
import { synthesizeSpine } from './spine.js';
import { validateFloor, floorHasErrors, floorPois, floorRooms } from '../safetymap/floor.js';
import { extractNavGraph, unreachableRooms } from '../safetymap/graph.js';
import { planRoutes } from '../safetymap/planner.js';

const OSM = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="47.6000180" lon="-122.3300000"/><node id="2" lat="47.6000180" lon="-122.3298670"/><node id="3" lat="47.6000898" lon="-122.3298670"/><node id="4" lat="47.6000898" lon="-122.3300000"/>
  <node id="5" lat="47.6000180" lon="-122.3298405"/><node id="6" lat="47.6000180" lon="-122.3297075"/><node id="7" lat="47.6000898" lon="-122.3297075"/><node id="8" lat="47.6000898" lon="-122.3298405"/>
  <node id="9" lat="47.6000180" lon="-122.3296809"/><node id="10" lat="47.6000180" lon="-122.3295479"/><node id="11" lat="47.6000898" lon="-122.3295479"/><node id="12" lat="47.6000898" lon="-122.3296809"/>
  <node id="13" lat="47.5999820" lon="-122.3300266"/><node id="14" lat="47.5999820" lon="-122.3295214"/><node id="15" lat="47.6000180" lon="-122.3295214"/><node id="16" lat="47.6000180" lon="-122.3300266"/>
  <node id="17" lat="47.6000180" lon="-122.3299335"><tag k="door" v="yes"/><tag k="level" v="0"/></node>
  <node id="18" lat="47.6000180" lon="-122.3297740"><tag k="door" v="yes"/><tag k="level" v="0"/></node>
  <node id="19" lat="47.6000180" lon="-122.3296144"><tag k="door" v="yes"/><tag k="level" v="0"/></node>
  <node id="20" lat="47.6000000" lon="-122.3300266"><tag k="emergency" v="exit"/><tag k="name" v="Exit West"/><tag k="level" v="0"/></node>
  <node id="21" lat="47.6000000" lon="-122.3295214"><tag k="entrance" v="main"/><tag k="name" v="Main Entrance &amp; Exit"/><tag k="wheelchair" v="no"/><tag k="level" v="0"/></node>
  <node id="22" lat="47.5999910" lon="-122.3297740"><tag k="emergency" v="defibrillator"/><tag k="level" v="0"/></node>
  <node id="23" lat="47.5999820" lon="-122.3300000"><tag k="emergency" v="assembly_point"/><tag k="name" v="Assembly Point"/><tag k="level" v="0"/></node>
  <node id="24" lat="47.5999910" lon="-122.3298537"><tag k="highway" v="steps"/><tag k="name" v="Stairwell 1"/><tag k="level" v="0"/></node>
  <node id="25" lat="47.6000500" lon="-122.3299335"><tag k="door" v="yes"/><tag k="level" v="1"/></node>
  <way id="101"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="indoor" v="room"/><tag k="name" v="Room 101"/><tag k="level" v="0"/></way>
  <way id="102"><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="8"/><nd ref="5"/><tag k="indoor" v="room"/><tag k="name" v="Room 102"/><tag k="level" v="0"/></way>
  <way id="103"><nd ref="9"/><nd ref="10"/><nd ref="11"/><nd ref="12"/><nd ref="9"/><tag k="indoor" v="room"/><tag k="name" v="Room 103"/><tag k="level" v="0"/></way>
  <way id="104"><nd ref="13"/><nd ref="14"/><nd ref="15"/><nd ref="16"/><nd ref="13"/><tag k="indoor" v="corridor"/><tag k="level" v="0"/></way>
  <way id="105"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="indoor" v="room"/><tag k="name" v="Upstairs"/><tag k="level" v="1"/></way>
</osm>`;

describe('OSM importer', () => {
  it('parses nodes, ways and tags with entities', () => {
    const d = parseOsm(OSM);
    expect(d.nodes.size).toBe(25);
    expect(d.ways).toHaveLength(5);
    expect(d.nodes.get('21')?.tags.name).toBe('Main Entrance & Exit');
  });
  it('converts level 0 into a routable floor with a synthesised spine and anchor', () => {
    const r = osmToFloor(OSM);
    expect(r.level).toBe('0');
    // 4 openings: three room doors plus the main entrance, which is both a door and an exit.
    expect(r.counts).toMatchObject({
      room: 3,
      walkway: 1,
      opening: 4,
      'amenity:exit': 2,
      'amenity:aed': 1,
      'amenity:assembly': 1,
      'amenity:stairwell': 1,
      path: 1,
    });
    expect(floorHasErrors(validateFloor(r.floor))).toBe(false);
    expect(floorRooms(r.floor).map((x) => x.name)).toEqual(['Room 101', 'Room 102', 'Room 103']);
    const exits = floorPois(r.floor).filter((p) => p.category === 'exit');
    expect(exits.find((e) => e.name.startsWith('Main'))?.accessible).toBe(false);
    const ex = extractNavGraph(r.floor);
    expect(unreachableRooms(ex)).toEqual([]);
    expect(ex.suspect).toEqual([]);
    expect(planRoutes({ floor: r.floor, mode: 'accessible' }).primary?.destination).toBe(
      'Exit West',
    );
    expect(Math.abs(r.anchor.lat - 47.60002)).toBeLessThan(0.001);
  });
  it('projects through a supplied anchor so the floor lands on the pack grid', () => {
    const r = osmToFloor(OSM, { anchor: { lng: -122.33, lat: 47.6 } });
    const aed = floorPois(r.floor).find((p) => p.category === 'aed')!;
    expect(aed.xy[0]).toBeGreaterThan(0); // east of the anchor
    expect(aed.xy[1]).toBeLessThan(0); // just south of it
  });
  it('spine synthesis: linear doors → one polyline; L-shaped → spanning segments', () => {
    expect(
      synthesizeSpine([
        [0, 0],
        [10, 0.1],
        [20, -0.1],
        [30, 0],
      ]),
    ).toHaveLength(1);
    const L = synthesizeSpine([
      [0, 0],
      [10, 0],
      [20, 0],
      [20, 10],
      [20, 20],
    ]);
    expect(L.length).toBeGreaterThan(1);
  });
});
