import { describe, expect, it } from 'vitest';
import { buildTravelCenter } from './travelCenter';
import { buildWorkbenchData } from './workbench';
import type { EntryFilters, VaultEntry } from '../types';

const today = new Date(2026, 4, 13);

const filters: EntryFilters = {
  lens: 'all',
  query: '',
  domain: '',
  privateMode: true,
  collection: '',
  entryProject: '',
  noteRole: '',
  taskStatus: '',
  taskPriority: '',
  taskProject: '',
};

function trip(entry: VaultEntry, tripKey: string, tripTitle: string): VaultEntry {
  return {
    ...entry,
    area: 'travel',
    properties: {
      ...entry.properties,
      module: 'travel',
      trip_key: tripKey,
      trip_title: tripTitle,
    },
  };
}

const entries: VaultEntry[] = [
  trip(
    { path: 'dates/methods-summit.md', filename: 'methods-summit.md', title: 'Methods Summit begins', type: 'conference', kind: 'event', date: '2026-06-03', private: false },
    'methods-summit',
    'Methods Summit / Northport',
  ),
  trip(
    { path: 'dates/methods-summit-checkout.md', filename: 'methods-summit-checkout.md', title: 'Example Hotel checkout', type: 'travel', kind: 'event', date: '2026-06-04', private: false },
    'methods-summit',
    'Methods Summit / Northport',
  ),
  trip(
    { path: 'dates/regional-meeting.md', filename: 'regional-meeting.md', title: 'Regional Meeting 2026', type: 'conference', kind: 'event', date: '2026-06-04', end_date: '2026-06-07', private: false },
    'regional-meeting',
    'Regional Meeting / Cedar Campus',
  ),
  trip(
    { path: 'projects/travel/notes/methods-summit-routing.md', filename: 'methods-summit-routing.md', title: 'Methods Summit travel routing', kind: 'travel-brief', private: false, modified_at: 10, snippet: 'Book-ready itinerary with flight options and an Example Hotel shortlist.' },
    'methods-summit',
    'Methods Summit / Northport',
  ),
  trip(
    { path: 'projects/travel/email-drafts/methods-summit.md', filename: 'methods-summit.md', title: 'Methods Summit approval email draft', kind: 'email-draft', private: false },
    'methods-summit',
    'Methods Summit / Northport',
  ),
  trip(
    { path: 'tasks/active/methods-summit.md', filename: 'methods-summit.md', title: 'Approve and book Methods Summit travel', kind: 'task', status: 'waiting', priority: '1', due: '2026-05-17', next: 'Obtain approval, then book the flight and hotel.', private: false },
    'methods-summit',
    'Methods Summit / Northport',
  ),
  trip(
    { path: 'tasks/done/regional-meeting.md', filename: 'regional-meeting.md', title: 'Regional Meeting logistics summary', kind: 'task', status: 'done', priority: '2', due: '2026-05-24', next: 'The meeting is local and needs no travel.', private: false },
    'regional-meeting',
    'Regional Meeting / Cedar Campus',
  ),
  trip(
    { path: 'tasks/active/westport.md', filename: 'westport.md', title: 'Submit Westport receipts', kind: 'task', status: 'open', priority: '2', due: '2026-05-14', private: false },
    'westport',
    'Westport workshop reimbursement',
  ),
  {
    path: 'projects/travel/travel-ledger.md',
    filename: 'travel-ledger.md',
    title: 'Travel expense ledger',
    kind: 'travel-ledger',
    area: 'travel',
    private: false,
    properties: {
      module: 'travel',
      research_account_limit_usd: 12000,
      ledger: [
        { id: 'methods-flight', trip_key: 'methods-summit', trip_title: 'Methods Summit / Northport', item: 'Flight estimate', category: 'transport', estimate: 500, currency: 'USD', status: 'approval_needed', reimbursable: true, counts_against_research_account: true, source: 'draft' },
        { id: 'methods-hotel', trip_key: 'methods-summit', trip_title: 'Methods Summit / Northport', item: 'Example Hotel reservation', category: 'lodging', currency: 'USD', status: 'booked_price_not_stored', reimbursable: true, counts_against_research_account: false, source: 'confirmation' },
        { id: 'regional-local', trip_key: 'regional-meeting', trip_title: 'Regional Meeting / Cedar Campus', item: 'Local; no travel', category: 'none', status: 'not_needed', reimbursable: false, source: 'local' },
        { id: 'westport-taxi', trip_key: 'westport', trip_title: 'Westport workshop reimbursement', item: 'Taxi return', category: 'local_transport', date: '2026-04-30', actual: 40.56, currency: 'USD', status: 'submitted', reimbursable: true, counts_against_research_account: true, source: 'receipt' },
        { id: 'westport-hotel', trip_key: 'westport', trip_title: 'Westport workshop reimbursement', item: 'Hotel', category: 'lodging', date: '2026-04-30', actual: 100, currency: 'USD', status: 'reimbursed', reimbursable: true, reimbursed_amount: 75, reimbursed_amount_usd: 75, counts_against_research_account: true, source: 'receipt' },
        { id: 'westport-meal', trip_key: 'westport', trip_title: 'Westport workshop reimbursement', item: 'Personal meal', category: 'meal', date: '2026-04-30', actual: 30, currency: 'USD', status: 'submitted', reimbursable: false, counts_against_research_account: false, source: 'receipt' },
        { id: 'westport-rail-eur', trip_key: 'westport', trip_title: 'Westport workshop reimbursement', item: 'Rail transfer', category: 'local_transport', date: '2026-04-30', actual: 34.90, actual_usd: 41.08, currency: 'EUR', status: 'submitted', reimbursable: true, counts_against_research_account: true, source: 'receipt' },
      ],
    },
  },
  trip(
    { path: 'tasks/active/private-trip.md', filename: 'private-trip.md', title: 'Private travel task', kind: 'task', status: 'open', priority: '1', due: '2026-05-15', private: true },
    'private-trip',
    'Private trip',
  ),
];

describe('travel center derivation', () => {
  it('groups travel records only through explicit trip metadata', () => {
    const data = buildTravelCenter(entries, undefined, today);
    const summit = data.trips.find((candidate) => candidate.title === 'Methods Summit / Northport');
    const regional = data.trips.find((candidate) => candidate.title === 'Regional Meeting / Cedar Campus');
    const westport = data.trips.find((candidate) => candidate.title === 'Westport workshop reimbursement');

    expect(summit?.startDate).toBe('2026-06-03');
    expect(summit?.endDate).toBe('2026-06-04');
    expect(summit?.missing.map((entry) => entry.title)).toEqual(['Approve and book Methods Summit travel']);
    expect(summit?.briefs.map((entry) => entry.title)).toContain('Methods Summit travel routing');
    expect(summit?.emailTemplates.map((entry) => entry.title)).toContain('Methods Summit approval email draft');
    expect(summit?.lane).toBe('needs-approval');
    expect(summit?.readiness.map((item) => [item.id, item.state])).toEqual([
      ['itinerary', 'done'],
      ['flights', 'waiting'],
      ['hotel', 'done'],
      ['reimbursement', 'unknown'],
    ]);
    expect(regional?.missing).toEqual([]);
    expect(regional?.lane).toBe('booked');
    expect(regional?.readiness.map((item) => item.state)).toEqual([
      'not-needed',
      'not-needed',
      'not-needed',
      'not-needed',
    ]);
    expect(westport?.lane).toBe('reimbursement');
    expect(westport?.unreimbursedActual).toBeCloseTo(136.64);
    expect(westport?.ytdActual).toBeCloseTo(211.64);
  });

  it('merges multiple records that declare the same trip key', () => {
    const august = new Date(2026, 7, 1);
    const records = [
      trip(
        { path: 'dates/association-window.md', filename: 'association-window.md', title: 'Association travel window', type: 'travel', kind: 'event', date: '2026-09-24', private: false },
        'association-meeting',
        'Regional Methods Meeting',
      ),
      trip(
        { path: 'dates/association-session.md', filename: 'association-session.md', title: 'Association conference session', type: 'conference', kind: 'event', date: '2026-09-25', private: false },
        'association-meeting',
        'Regional Methods Meeting',
      ),
      trip(
        { path: 'projects/travel/association.md', filename: 'association.md', title: 'Association logistics', kind: 'travel-brief', private: false },
        'association-meeting',
        'Regional Methods Meeting',
      ),
    ];

    const data = buildTravelCenter(records, undefined, august);
    expect(data.trips).toHaveLength(1);
    expect(data.trips[0]).toMatchObject({ title: 'Regional Methods Meeting', startDate: '2026-09-24' });
    expect(data.trips[0].events).toHaveLength(2);
    expect(data.trips[0].briefs).toHaveLength(1);
  });

  it('removes settled past and cancelled trips while retaining ledger rows', () => {
    const afterTrip = new Date(2026, 6, 1);
    const settled = [
      trip(
        { path: 'dates/closed-meeting.md', filename: 'closed-meeting.md', title: 'Closed meeting', type: 'conference', kind: 'event', date: '2026-06-04', private: false },
        'closed-meeting',
        'Closed meeting',
      ),
      {
        path: 'projects/travel/ledger.md',
        filename: 'ledger.md',
        title: 'Ledger',
        kind: 'travel-ledger',
        private: false,
        properties: {
          ledger: [
            { id: 'closed-row', trip_key: 'closed-meeting', trip_title: 'Closed meeting', item: 'Host-paid lodging', category: 'lodging', status: 'not_reimbursable', reimbursable: false },
            { id: 'cancelled-row', trip_key: 'cancelled-meeting', trip_title: 'Cancelled meeting', item: 'Cancelled reservation', category: 'transport', status: 'cancelled', reimbursable: false },
          ],
        },
      },
    ];

    const data = buildTravelCenter(settled, undefined, afterTrip);
    expect(data.trips.map((candidate) => candidate.title)).toEqual([]);
    expect(data.ledgerItems.map((item) => item.tripTitle)).toEqual(['Closed meeting', 'Cancelled meeting']);
  });

  it('computes research-account totals only from opted-in ledger rows', () => {
    const summary = buildTravelCenter(entries, undefined, today).summary;

    expect(summary.totalEstimate).toBe(500);
    expect(summary.grossActualUsd).toBeCloseTo(211.64);
    expect(summary.reimbursedUsd).toBe(75);
    expect(summary.outOfPocketUsd).toBeCloseTo(136.64);
    expect(summary.pendingExpectedReimbursementUsd).toBeCloseTo(81.64);
    expect(summary.expectedNetUsd).toBeCloseTo(55);
    expect(summary.researchAccountYtdActualUsd).toBeCloseTo(181.64);
    expect(summary.researchAccountYtdReimbursedUsd).toBe(75);
    expect(summary.researchAccountPlannedUsd).toBe(500);
    expect(summary.researchAccountYtdPlusPlannedUsd).toBeCloseTo(681.64);
    expect(summary.researchAccountRemainingAfterPlannedUsd).toBeCloseTo(11318.36);
  });

  it('shows only conference-like events in the calendar strip', () => {
    const data = buildTravelCenter(entries, undefined, today);
    expect(data.calendarItems.map((entry) => entry.title)).toEqual([
      'Methods Summit begins',
      'Regional Meeting 2026',
    ]);
  });

  it('keeps approval-needed trips in the approval lane when receipts are mentioned', () => {
    const records = [
      trip(
        { path: 'tasks/active/global-meeting.md', filename: 'global-meeting.md', title: 'Global meeting booking approval', kind: 'task', status: 'open', due: '2026-05-22', next: 'A registration receipt exists; travel approval is still required.', private: false },
        'global-meeting',
        'Global meeting / Hillview',
      ),
      {
        path: 'projects/travel/ledger.md',
        filename: 'ledger.md',
        title: 'Ledger',
        kind: 'travel-ledger',
        private: false,
        properties: {
          ledger: [{
            id: 'global-meeting-estimate',
            trip_key: 'global-meeting',
            trip_title: 'Global meeting / Hillview',
            item: 'Flight and hotel estimate',
            category: 'flight_lodging_transport',
            estimate: 2700,
            currency: 'USD',
            status: 'needs_reprice_and_approval_channel',
            reimbursable: true,
          }],
        },
      },
    ];
    const candidate = buildTravelCenter(records, undefined, today).trips[0];
    expect(candidate.lane).toBe('needs-approval');
    expect(candidate.readiness.find((item) => item.id === 'reimbursement')?.detail).toBe('No actuals yet');
  });

  it('respects private-mode filtering before building travel data', () => {
    const data = buildWorkbenchData(entries, filters, today);
    expect(data.travelCenter.trips.map((candidate) => candidate.title)).not.toContain('Private trip');
  });
});
