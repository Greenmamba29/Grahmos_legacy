import { describe, expect, it } from 'vitest';
import { parseStep } from './step.js';
import { ifcToFloor } from './ifc.js';
import { validateFloor, floorHasErrors, floorRooms, floorPois } from '../safetymap/floor.js';
import { extractNavGraph, unreachableRooms } from '../safetymap/graph.js';

const IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Minimal clinic floor'),'2;1');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
/* storey at origin */
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCLOCALPLACEMENT($,#2);
#4=IFCBUILDINGSTOREY('storey1',$,'Level 1',$,$,#3,$,'Level 1',.ELEMENT.,0.);
#5=IFCCARTESIANPOINT((0.,0.));
#6=IFCCARTESIANPOINT((10.,0.));
#7=IFCCARTESIANPOINT((10.,10.));
#8=IFCCARTESIANPOINT((0.,10.));
#9=IFCPOLYLINE((#5,#6,#7,#8,#5));
#10=IFCSHAPEREPRESENTATION($,'FootPrint','Curve2D',(#9));
#11=IFCPRODUCTDEFINITIONSHAPE($,$,(#10));
#12=IFCCARTESIANPOINT((-18.,2.,0.));
#13=IFCAXIS2PLACEMENT3D(#12,$,$);
#14=IFCLOCALPLACEMENT(#3,#13);
#15=IFCSPACE('wardA',$,'Ward A',$,$,#14,#11,'Ward A',$,.INTERNAL.,$);
#16=IFCCARTESIANPOINT((-6.,2.,0.));
#17=IFCAXIS2PLACEMENT3D(#16,$,$);
#18=IFCLOCALPLACEMENT(#3,#17);
#19=IFCSPACE('wardB',$,'Ward B',$,$,#18,#11,'Ward B',$,.INTERNAL.,$);
#20=IFCCARTESIANPOINT((8.,2.,0.));
#21=IFCAXIS2PLACEMENT3D(#20,$,$);
#22=IFCLOCALPLACEMENT(#3,#21);
#23=IFCSPACE('wardC',$,'Ward C',$,$,#22,#11,'Ward C',$,.INTERNAL.,$);
#24=IFCCARTESIANPOINT((-18.,-12.,0.));
#25=IFCAXIS2PLACEMENT3D(#24,$,$);
#26=IFCLOCALPLACEMENT(#3,#25);
#27=IFCSPACE('triage',$,'Triage',$,$,#26,#11,'Triage',$,.INTERNAL.,$);
#28=IFCCARTESIANPOINT((8.,-12.,0.));
#29=IFCAXIS2PLACEMENT3D(#28,$,$);
#30=IFCLOCALPLACEMENT(#3,#29);
#31=IFCSPACE('firstaid',$,'First Aid',$,$,#30,#11,'First Aid Room',$,.INTERNAL.,$);
#32=IFCCARTESIANPOINT((-13.,2.,0.));
#33=IFCAXIS2PLACEMENT3D(#32,$,$);
#34=IFCLOCALPLACEMENT(#3,#33);
#35=IFCDOOR('doorA',$,'Door A',$,$,#34,$,$,$,$);
#36=IFCCARTESIANPOINT((-1.,2.,0.));
#37=IFCAXIS2PLACEMENT3D(#36,$,$);
#38=IFCLOCALPLACEMENT(#3,#37);
#39=IFCDOOR('doorB',$,'Door B',$,$,#38,$,$,$,$);
#40=IFCCARTESIANPOINT((13.,2.,0.));
#41=IFCAXIS2PLACEMENT3D(#40,$,$);
#42=IFCLOCALPLACEMENT(#3,#41);
#43=IFCDOOR('doorC',$,'Door C',$,$,#42,$,$,$,$);
#44=IFCCARTESIANPOINT((-13.,-2.,0.));
#45=IFCAXIS2PLACEMENT3D(#44,$,$);
#46=IFCLOCALPLACEMENT(#3,#45);
#47=IFCDOOR('doorD',$,'Door D',$,$,#46,$,$,$,$);
#48=IFCCARTESIANPOINT((-20.,0.,0.));
#49=IFCAXIS2PLACEMENT3D(#48,$,$);
#50=IFCLOCALPLACEMENT(#3,#49);
#51=IFCDOOR('exitW',$,'Exit West',$,$,#50,$,$,$,$);
#52=IFCCARTESIANPOINT((20.,0.,0.));
#53=IFCAXIS2PLACEMENT3D(#52,$,$);
#54=IFCLOCALPLACEMENT(#3,#53);
#55=IFCDOOR('exitE',$,'Exit East (stair)',$,$,#54,$,$,$,$);
#56=IFCCARTESIANPOINT((0.,-2.,0.));
#57=IFCAXIS2PLACEMENT3D(#56,$,$);
#58=IFCLOCALPLACEMENT(#3,#57);
#59=IFCSTAIR('stair1',$,'Stairwell 1',$,$,#58,$,$,$);
ENDSEC;
END-ISO-10303-21;`;

describe('IFC importer', () => {
  it('parses STEP records with refs, enums, strings and lists', () => {
    const m = parseStep(IFC);
    expect(m.byType('IFCSPACE')).toHaveLength(5);
    expect(m.records.get(4)?.args[7]).toBe('Level 1');
    expect(m.records.get(14)?.args[0]).toEqual({ ref: 3 });
  });
  it('converts spaces, doors and stairs into a routable floor', () => {
    const r = ifcToFloor(IFC);
    expect(r.storey).toBe('Level 1');
    expect(r.counts).toMatchObject({
      room: 4,
      opening: 4,
      'amenity:exit': 2,
      'amenity:stairwell': 1,
      'amenity:first_aid': 1,
    });
    expect(floorHasErrors(validateFloor(r.floor))).toBe(false);
    expect(
      floorRooms(r.floor)
        .map((x) => x.name)
        .sort(),
    ).toEqual(['Triage', 'Ward A', 'Ward B', 'Ward C']);
    const exits = floorPois(r.floor).filter((p) => p.category === 'exit');
    expect(exits.find((e) => e.name.startsWith('Exit East'))?.accessible).toBe(false);
    const ex = extractNavGraph(r.floor);
    expect(unreachableRooms(ex)).toEqual([]);
    // Every ward has a door attributed by containment or nearest centroid, so nothing is inferred.
    expect(r.inferredOpenings).toBe(0);
  });
  it('infers an opening for a door-less space and marks it', () => {
    const noDoors = IFC.replace(/#4[37]=IFCDOOR[^\n]*\n/g, '');
    const r = ifcToFloor(noDoors);
    expect(r.inferredOpenings).toBeGreaterThan(0);
    expect(r.floor.features.filter((f) => f.properties?.inferred === true)).toHaveLength(
      r.inferredOpenings,
    );
    expect(unreachableRooms(extractNavGraph(r.floor))).toEqual([]);
  });
});
