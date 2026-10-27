/**
 * Incident playbooks: what the console DOES when an incident type is declared, and what each role
 * is told. Routing policy maps to the planner; instructions are the role cards the UI shows.
 */
import type { IncidentType } from '../comms/types.js';
import type { RouteMode } from './planner.js';

export type AutoRoute =
  | { kind: 'evacuate'; mode: RouteMode }
  | { kind: 'asset'; asset: 'aed' | 'first_aid' | 'fire_extinguisher' }
  | { kind: 'shelter' }
  | { kind: 'none' };

export interface Playbook {
  type: IncidentType;
  label: string;
  /** What the map does on declaration. */
  autoRoute: AutoRoute;
  /** Banner shown over the map. */
  banner: string;
  instructions: Record<'occupant' | 'responder' | 'operator', string[]>;
  /** Default alert the operator can broadcast with one tap. */
  defaultAlert: {
    title: string;
    body: string;
    severity: 'critical' | 'high' | 'moderate' | 'low' | 'info';
  };
}

export const PLAYBOOKS: Record<IncidentType, Playbook> = {
  fire: {
    type: 'fire',
    label: 'Fire',
    autoRoute: { kind: 'evacuate', mode: 'occupant' },
    banner:
      'EVACUATE — follow the highlighted route to the nearest clear exit. Do not use elevators.',
    instructions: {
      occupant: [
        'Leave now by the highlighted route.',
        'Do not use elevators.',
        'Close doors behind you.',
        'Report to the assembly point and check in.',
      ],
      responder: [
        'Approach via the responder route; hazard zone is marked.',
        'Confirm the alarm zone and sweep rooms nearest the hazard.',
        'Report conditions on the incident log.',
      ],
      operator: [
        'Broadcast the evacuation alert.',
        'Watch acknowledgements and check-ins.',
        'Log every change of status; resolve only when the all-clear is confirmed.',
      ],
    },
    defaultAlert: {
      title: 'Evacuate now',
      body: 'Fire reported. Leave by the nearest clear exit shown on your device. Do not use elevators.',
      severity: 'critical',
    },
  },
  medical: {
    type: 'medical',
    label: 'Medical',
    autoRoute: { kind: 'asset', asset: 'aed' },
    banner: 'MEDICAL — nearest AED and first aid are highlighted. Send a runner for the AED.',
    instructions: {
      occupant: ['Keep the area clear.', 'If trained, begin CPR when directed.'],
      responder: [
        'Retrieve the highlighted AED.',
        'Bring first-aid kit from the nearest station.',
        'Log patient status on arrival.',
      ],
      operator: [
        'Dispatch the nearest responder.',
        'Call emergency medical services if not already done.',
        'Keep the route to the patient clear.',
      ],
    },
    defaultAlert: {
      title: 'Medical response',
      body: 'Medical emergency in progress. Trained responders: retrieve the nearest AED.',
      severity: 'high',
    },
  },
  lockdown: {
    type: 'lockdown',
    label: 'Lockdown',
    autoRoute: { kind: 'shelter' },
    banner: 'LOCKDOWN — move to the nearest securable room, lock doors, silence devices.',
    instructions: {
      occupant: [
        'Get into the nearest room that locks.',
        'Lock and barricade the door, lights off, stay silent.',
        'Do not open the door until the all-clear comes from the console.',
      ],
      responder: [
        'Hold your position unless directed.',
        'Report your location and headcount by check-in.',
      ],
      operator: [
        'Broadcast the lockdown alert.',
        'Track check-ins by location.',
        'Coordinate with law enforcement; issue the all-clear only on their confirmation.',
      ],
    },
    defaultAlert: {
      title: 'Lockdown',
      body: 'Lockdown in effect. Move to a securable room, lock the door, stay silent. Await the all-clear.',
      severity: 'critical',
    },
  },
  outage: {
    type: 'outage',
    label: 'Power / utility outage',
    autoRoute: { kind: 'none' },
    banner:
      'OUTAGE — emergency lighting active. Stairwells and exits are marked; elevators are out.',
    instructions: {
      occupant: ['Stay where you are unless told to move.', 'Do not use elevators.'],
      responder: [
        'Check elevator cars for trapped occupants.',
        'Verify critical equipment on emergency power.',
      ],
      operator: ['Confirm generator transfer.', 'Log affected areas.', 'Escalate to facilities.'],
    },
    defaultAlert: {
      title: 'Power outage',
      body: 'Power is out. Emergency lighting is active. Do not use elevators. Await instructions.',
      severity: 'moderate',
    },
  },
  severe_weather: {
    type: 'severe_weather',
    label: 'Severe weather',
    autoRoute: { kind: 'shelter' },
    banner: 'SHELTER — move to interior rooms away from glass. Avoid exits until the all-clear.',
    instructions: {
      occupant: [
        'Move to an interior room or refuge area.',
        'Stay away from windows.',
        'Do not leave the building.',
      ],
      responder: ['Direct people away from glazed areas.', 'Check refuge areas for capacity.'],
      operator: [
        'Broadcast shelter-in-place.',
        'Monitor the weather feed when online; log conditions when not.',
      ],
    },
    defaultAlert: {
      title: 'Shelter in place',
      body: 'Severe weather. Move to interior rooms away from windows. Do not exit the building.',
      severity: 'high',
    },
  },
  hazmat: {
    type: 'hazmat',
    label: 'Hazardous material',
    autoRoute: { kind: 'evacuate', mode: 'occupant' },
    banner: 'HAZMAT — evacuate away from the release. Routes avoid the hazard zone.',
    instructions: {
      occupant: [
        'Leave by the highlighted route, upwind of the release.',
        'Do not touch spilled material.',
      ],
      responder: ['Isolate the area at the marked radius.', 'Do not enter without PPE.'],
      operator: ['Broadcast evacuation for affected floors.', 'Notify hazmat and facilities.'],
    },
    defaultAlert: {
      title: 'Evacuate — hazardous release',
      body: 'Hazardous material released. Evacuate by the route on your device, avoiding the marked zone.',
      severity: 'critical',
    },
  },
  other: {
    type: 'other',
    label: 'Other incident',
    autoRoute: { kind: 'none' },
    banner: 'INCIDENT — follow operator instructions.',
    instructions: {
      occupant: ['Await instructions from the console.'],
      responder: ['Report to the operator for assignment.'],
      operator: ['Describe the incident in the log.', 'Choose a routing profile manually.'],
    },
    defaultAlert: {
      title: 'Incident notice',
      body: 'An incident has been declared. Await instructions.',
      severity: 'moderate',
    },
  },
};

export const playbookFor = (type: IncidentType): Playbook => PLAYBOOKS[type];
