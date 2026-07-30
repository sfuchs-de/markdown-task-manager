import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TravelCenterView } from './App';
import { buildTravelCenter } from './lib/travelCenter';
import type { VaultEntry } from './types';

const today = new Date(2026, 4, 13);

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
    { path: 'dates/methods-checkout.md', filename: 'methods-checkout.md', title: 'Example Hotel checkout', type: 'travel', kind: 'event', date: '2026-06-04', private: false },
    'methods-summit',
    'Methods Summit / Northport',
  ),
  trip(
    { path: 'dates/regional-meeting.md', filename: 'regional-meeting.md', title: 'Regional Meeting 2026', type: 'conference', kind: 'event', date: '2026-06-04', end_date: '2026-06-07', private: false },
    'regional-meeting',
    'Regional Meeting / Cedar Campus',
  ),
  trip(
    { path: 'projects/travel/methods-routing.md', filename: 'methods-routing.md', title: 'Methods Summit travel routing', kind: 'travel-brief', private: false, modified_at: 10, snippet: 'Book-ready itinerary with flight and hotel options.' },
    'methods-summit',
    'Methods Summit / Northport',
  ),
  trip(
    { path: 'projects/travel/methods-email.md', filename: 'methods-email.md', title: 'Methods Summit approval email draft', kind: 'email-draft', private: false },
    'methods-summit',
    'Methods Summit / Northport',
  ),
  trip(
    { path: 'tasks/active/methods-summit.md', filename: 'methods-summit.md', title: 'Approve and book Methods Summit travel', kind: 'task', status: 'waiting', priority: '1', due: '2026-05-17', private: false },
    'methods-summit',
    'Methods Summit / Northport',
  ),
  trip(
    { path: 'tasks/done/regional-meeting.md', filename: 'regional-meeting.md', title: 'Regional Meeting logistics summary', kind: 'task', status: 'done', priority: '2', due: '2026-05-24', next: 'The meeting is local and needs no travel.', private: false },
    'regional-meeting',
    'Regional Meeting / Cedar Campus',
  ),
  {
    path: 'projects/travel/travel-ledger.md',
    filename: 'travel-ledger.md',
    title: 'Travel expense ledger',
    kind: 'travel-ledger',
    private: false,
    properties: {
      research_account_limit_usd: 12000,
      ledger: [
        { id: 'methods-flight', trip_key: 'methods-summit', trip_title: 'Methods Summit / Northport', item: 'Flight estimate', category: 'transport', estimate: 500, currency: 'USD', status: 'approval_needed', reimbursable: true, counts_against_research_account: true },
        { id: 'methods-hotel', trip_key: 'methods-summit', trip_title: 'Methods Summit / Northport', item: 'Example Hotel reservation', category: 'lodging', currency: 'USD', status: 'booked_price_not_stored', reimbursable: true },
        { id: 'regional-local', trip_key: 'regional-meeting', trip_title: 'Regional Meeting / Cedar Campus', item: 'Local; no travel', category: 'none', status: 'not_needed', reimbursable: false },
        { id: 'westport-taxi', trip_key: 'westport', trip_title: 'Westport workshop reimbursement', item: 'Taxi return', category: 'local_transport', date: '2026-04-30', actual: 40.56, currency: 'USD', status: 'submitted', reimbursable: true, counts_against_research_account: true },
      ],
    },
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(today);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TravelCenterView', () => {
  it('renders travel planning, accounting, and task actions', () => {
    const onOpen = vi.fn();
    const onPatch = vi.fn();
    const data = buildTravelCenter(entries, undefined, today);

    render(
      <TravelCenterView
        data={data}
        onOpen={onOpen}
        onPatchTaskMetadata={onPatch}
        patchingTaskPath=""
      />,
    );

    expect(screen.getByRole('heading', { name: 'Travel Center' })).toBeVisible();
    const switcher = screen.getByLabelText('Travel Center section');
    expect(within(switcher).getByRole('button', { name: 'Overview' })).toHaveClass('active');
    expect(screen.getAllByText('Methods Summit / Northport')[0]).toBeVisible();
    expect(screen.getByLabelText('Methods Summit / Northport conference overview')).toBeVisible();
    expect(screen.getAllByText('Awaiting approval')[0]).toBeVisible();
    expect(screen.getAllByText('Booked')[0]).toBeVisible();
    expect(screen.getAllByText('No actuals yet')[0]).toBeVisible();
    expect(screen.getByLabelText('Regional Meeting / Cedar Campus conference overview')).toBeVisible();
    expect(screen.getAllByText('Not needed')[0]).toBeVisible();
    expect(screen.getByText('Event strip')).toBeVisible();
    expect(screen.getAllByText('Methods Summit begins')[0]).toBeVisible();
    expect(within(screen.getByLabelText('Travel calendar strip')).queryByText('Example Hotel checkout')).not.toBeInTheDocument();

    fireEvent.click(within(switcher).getByRole('button', { name: 'Accounting' }));
    expect(screen.getByText('Expenditure tracking')).toBeVisible();
    expect(screen.getByText('Accounting legend')).toBeVisible();
    expect(screen.getByText('Actual paid by traveler')).toBeVisible();
    expect(screen.getAllByText('Research travel account')[0]).toBeVisible();
    expect(screen.getByText('External / personal coverage')).toBeVisible();
    expect(screen.getAllByText('Flight estimate')[0]).toBeVisible();
    expect(screen.getByText('Planned account coverage')).toBeVisible();
    expect(screen.getAllByText('$40.56')[0]).toBeVisible();
    expect(screen.getByText('Taxi return')).toBeVisible();

    fireEvent.click(within(switcher).getByRole('button', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Methods Summit \/ Northport overview/ }));
    expect(screen.getAllByRole('heading', { name: 'Methods Summit / Northport' })[0]).toBeVisible();
    expect(screen.getByText('Trip file map')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Methods Summit travel routing/ })[0]).toBeVisible();
    expect(screen.getByRole('button', { name: /Methods Summit approval email draft/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Ledger row: Flight estimate/ })).toBeVisible();

    fireEvent.click(screen.getAllByRole('button', { name: /Methods Summit travel routing/ })[0]);
    expect(onOpen).toHaveBeenCalledWith('projects/travel/methods-routing.md');

    fireEvent.click(screen.getByRole('button', { name: 'Expense ledger' }));
    expect(onOpen).toHaveBeenCalledWith('projects/travel/travel-ledger.md');

    const taskCard = screen.getByText('Approve and book Methods Summit travel').closest('article') as HTMLElement;
    fireEvent.click(within(taskCard).getByText('More'));
    fireEvent.click(within(taskCard).getByRole('button', { name: 'Done' }));
    expect(onPatch).toHaveBeenCalledWith('tasks/active/methods-summit.md', { status: 'done' });
  });
});
