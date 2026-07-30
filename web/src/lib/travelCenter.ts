import { entryLens, isTask } from './filters';
import { buildSubmissions, type ConferenceSubmission } from './submissions';
import type { VaultEntry } from '../types';

export type TravelLaneId = 'needs-approval' | 'ready-book' | 'booked' | 'reimbursement' | 'leads';

export interface OverviewTravelItem {
  key: string;
  title: string;
  project?: string | null;
  kind: string;
  startDate?: string | null;
  endDate?: string | null;
  anchor: VaultEntry;
  missing: VaultEntry[];
  briefs: VaultEntry[];
}

export interface TravelLedgerItem {
  id: string;
  tripKey: string;
  tripTitle: string;
  item: string;
  category: string;
  status: string;
  date: string;
  reimbursable: boolean;
  coverageSource: string;
  budgetAccount: string;
  countsAgainstResearchAccount: boolean;
  estimate: number | null;
  actual: number | null;
  estimateUsd: number | null;
  actualUsd: number | null;
  reimbursedAmount: number | null;
  reimbursedAmountUsd: number | null;
  reimbursedDate: string;
  currency: string;
  source: string;
  receiptPointer: string;
  privatePointer: string;
  notePath: string;
}

export interface TravelChecklistItem {
  id: string;
  label: string;
  state: 'done' | 'open' | 'blocked' | 'unknown';
}

export type TravelReadinessState = 'done' | 'open' | 'blocked' | 'waiting' | 'not-needed' | 'unknown';

export interface TravelReadinessItem {
  id: 'itinerary' | 'flights' | 'hotel' | 'reimbursement';
  label: string;
  state: TravelReadinessState;
  detail: string;
}

export interface TravelTrip extends OverviewTravelItem {
  events: VaultEntry[];
  ledgerItems: TravelLedgerItem[];
  emailTemplates: VaultEntry[];
  lane: TravelLaneId;
  laneLabel: string;
  checklist: TravelChecklistItem[];
  readiness: TravelReadinessItem[];
  totalEstimate: number;
  totalActual: number;
  unreimbursedActual: number;
  plannedEstimate: number;
  ytdActual: number;
  statusLabel: string;
}

export interface TravelLane {
  id: TravelLaneId;
  title: string;
  detail: string;
  trips: TravelTrip[];
}

export interface TravelCenterSummary {
  nextTrip: TravelTrip | null;
  urgentBlocker: VaultEntry | null;
  approvalNeeded: number;
  bookedUpcoming: number;
  reimbursementItems: number;
  totalEstimate: number;
  totalActual: number;
  unreimbursedActual: number;
  grossActualUsd: number;
  reimbursedUsd: number;
  outOfPocketUsd: number;
  expectedNetUsd: number;
  pendingExpectedReimbursementUsd: number;
  ytdActualUsd: number;
  ytdReimbursedUsd: number;
  ytdOutOfPocketUsd: number;
  plannedUsd: number;
  plannedReimbursableUsd: number;
  ytdPlusPlannedUsd: number;
  researchAccountLimitUsd: number;
  researchAccountYtdActualUsd: number;
  researchAccountYtdReimbursedUsd: number;
  researchAccountYtdPendingUsd: number;
  researchAccountPlannedUsd: number;
  researchAccountYtdPlusPlannedUsd: number;
  researchAccountRemainingAfterPlannedUsd: number;
  researchAccountOverPlannedUsd: number;
  researchAccountUsedPct: number;
}

export interface TravelCenterData {
  trips: TravelTrip[];
  lanes: TravelLane[];
  ledgerItems: TravelLedgerItem[];
  summary: TravelCenterSummary;
  upcomingTravel: OverviewTravelItem[];
  calendarItems: VaultEntry[];
  submissions: ConferenceSubmission[];
  ledgerPath: string | null;
}

const DONE_STATUSES = new Set(['done', 'complete', 'completed', 'cancelled', 'dropped', 'archive', 'archived']);
const TRAVEL_EVENT_KINDS = new Set(['travel', 'conference', 'seminar', 'workshop']);
const TRAVEL_STRIP_EVENT_KINDS = new Set(['conference', 'seminar', 'workshop']);
const UPCOMING_TRAVEL_MONTHS = 3;
const DEFAULT_RESEARCH_ACCOUNT_LIMIT_USD = 12_000;
const LEDGER_STATUSES_REIMBURSED = new Set(['reimbursed', 'paid', 'complete', 'done', 'not_needed', 'not needed']);
const LEDGER_STATUSES_BOOKED = new Set(['booked', 'reserved', 'confirmed', 'booked_price_not_stored', 'booked payment pending', 'booked_payment_pending', 'submitted', 'reimbursed', 'paid']);
const LEDGER_STATUSES_REIMBURSEMENT = new Set(['receipts_collected', 'receipts collected', 'submitted', 'reimbursement_pending', 'reimbursement pending', 'blocked']);
const LEDGER_STATUSES_PENDING_REIMBURSEMENT = new Set(['submitted', 'reimbursement_pending', 'reimbursement pending']);
const LEDGER_STATUSES_NOT_NEEDED = new Set(['not_needed', 'not needed', 'no_additional_travel_needed', 'no additional travel needed']);
const LEDGER_STATUSES_CANCELLED = new Set(['cancelled', 'canceled']);
// A trip is "settled" when nothing is left to manage: reimbursed/paid/etc.,
// host-paid or local (not_reimbursable), or cancelled. Such trips drop off the
// active board even though their rows are not literally "reimbursed".
const LEDGER_STATUSES_SETTLED = new Set([
  ...LEDGER_STATUSES_REIMBURSED,
  'not_reimbursable',
  ...LEDGER_STATUSES_CANCELLED,
]);
const LEDGER_STATUSES_NEED_APPROVAL = new Set([
  'approval_needed',
  'approval needed',
  'waiting_on_approval_channel',
  'waiting on approval channel',
  'needs_reprice_and_approval_channel',
  'needs reprice and approval channel',
]);
const LANE_ORDER: TravelLaneId[] = ['needs-approval', 'ready-book', 'booked', 'reimbursement', 'leads'];
const LANE_LABELS: Record<TravelLaneId, string> = {
  'needs-approval': 'Needs approval',
  'ready-book': 'Ready to book',
  booked: 'Booked / upcoming',
  reimbursement: 'Reimbursement',
  leads: 'Leads / TBD',
};
const LANE_DETAILS: Record<TravelLaneId, string> = {
  'needs-approval': 'Approval, routing, or cost sign-off is the blocker',
  'ready-book': 'Approval is clear enough; booking or logistics remain',
  booked: 'Known trip windows with no immediate booking blocker',
  reimbursement: 'Receipts, packets, submission, or reimbursement follow-up',
  leads: 'Date or invitation is still conditional',
};

const TRAVEL_ACTION_TERMS = [
  'approval',
  'book',
  'booking',
  'flight',
  'hotel',
  'lodging',
  'reimbursement',
  'receipt',
  'registration',
  'rsvp',
  'seminar',
  'travel',
  'visit',
];

interface TravelGroup {
  key: string;
  title: string;
  events: VaultEntry[];
  tasks: VaultEntry[];
  briefs: VaultEntry[];
  emailTemplates: VaultEntry[];
  ledgerItems: TravelLedgerItem[];
}

function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function parseEntryDate(value?: string | null): Date | null {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function daysUntil(value: string | null | undefined, today = new Date()): number | null {
  const parsed = parseEntryDate(value);
  if (!parsed) return null;
  return dayNumber(parsed) - dayNumber(today);
}

function addMonthsClamped(date: Date, months: number): Date {
  const targetMonth = date.getMonth() + months;
  const candidate = new Date(date.getFullYear(), targetMonth, date.getDate());
  if (candidate.getMonth() === ((targetMonth % 12) + 12) % 12) return candidate;
  return new Date(date.getFullYear(), targetMonth + 1, 0);
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(scalarText).filter(Boolean).join(', ');
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).map(scalarText).filter(Boolean).join(', ');
  return String(value).trim();
}

function numericAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['true', 'yes', 'y', '1'].includes(String(value || '').toLowerCase());
}

function optionalBooleanValue(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  return null;
}

function normalizedUsdAmount(rawAmount: number | null, rawUsdAmount: unknown, currency: string): number | null {
  const parsedUsd = numericAmount(rawUsdAmount);
  if (parsedUsd !== null) return parsedUsd;
  return currency.toUpperCase() === 'USD' ? rawAmount : null;
}

function ledgerRowCountsAgainstResearchAccount(row: Record<string, unknown>, coverageSource: string, budgetAccount: string): boolean {
  const explicit = optionalBooleanValue(
    row.counts_against_research_account
    ?? row.countsAgainstResearchAccount
    ?? row.research_account,
  );
  return explicit ?? false;
}

function isOpenTask(entry: VaultEntry): boolean {
  return isTask(entry) && !DONE_STATUSES.has(String(entry.status || '').toLowerCase());
}

function entrySearchText(entry: VaultEntry): string {
  return [
    entry.title,
    entry.project,
    entry.kind,
    entry.type,
    entry.status,
    entry.next,
    entry.snippet,
    entry.path,
    ...Object.values(entry.properties || {}).map(scalarText),
  ].filter(Boolean).join(' ').toLowerCase();
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function entryMetadataValue(entry: VaultEntry, ...names: string[]): string {
  const record = entry as unknown as Record<string, unknown>;
  for (const name of names) {
    const value = record[name] ?? entry.properties?.[name];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

function normalizedTripKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function travelTokens(entry: VaultEntry): Set<string> {
  const key = normalizedTripKey(entryMetadataValue(entry, 'trip_key', 'tripKey', 'trip'));
  return key ? new Set([key]) : new Set();
}

function hasSharedTravelToken(a: VaultEntry, b: VaultEntry): boolean {
  const aTokens = travelTokens(a);
  if (aTokens.size === 0) return false;
  const bTokens = travelTokens(b);
  return [...aTokens].some((token) => bTokens.has(token));
}

function isTravelEvent(entry: VaultEntry): boolean {
  if (isTask(entry)) return false;
  if (!(entry.due || entry.date || entry.start_date)) return false;
  const kind = String(entry.type || entry.kind || entry.explicit_type || entry.explicit_kind || '').toLowerCase();
  if (kind.includes('deadline') || kind.includes('project') || kind.includes('log') || kind.includes('status') || kind === 'date') return false;
  if (TRAVEL_EVENT_KINDS.has(kind)) return true;
  const module = entryMetadataValue(entry, 'module');
  return (kind === 'event' || kind === 'calendar') && module === 'travel' && travelTokens(entry).size > 0;
}

function isTravelStripEvent(entry: VaultEntry): boolean {
  if (!isTravelEvent(entry)) return false;
  const kind = String(entry.type || entry.kind || entry.explicit_type || entry.explicit_kind || '').toLowerCase();
  return TRAVEL_STRIP_EVENT_KINDS.has(kind);
}

function isTravelBrief(entry: VaultEntry): boolean {
  if (isTask(entry)) return false;
  const kind = String(entry.kind || entry.type || entry.explicit_kind || entry.explicit_type || '').toLowerCase();
  if (kind === 'travel-ledger') return false;
  return ['travel-brief', 'travel-note', 'itinerary'].includes(kind);
}

function isTravelEmailTemplate(entry: VaultEntry): boolean {
  if (isTask(entry)) return false;
  const kind = String(entry.kind || entry.type || entry.explicit_kind || entry.explicit_type || '').toLowerCase();
  return ['travel-email', 'travel-email-template'].includes(kind)
    || (kind === 'email-draft' && entryMetadataValue(entry, 'module') === 'travel');
}

function isTravelActionTask(entry: VaultEntry): boolean {
  if (!isOpenTask(entry)) return false;
  const kind = String(entry.kind || entry.type || '').toLowerCase();
  const module = entryMetadataValue(entry, 'module');
  const area = String(entry.area || '').toLowerCase();
  return kind === 'travel-task' || module === 'travel' || area === 'travel';
}

function relatedTravelBrief(anchor: VaultEntry, brief: VaultEntry): boolean {
  return hasSharedTravelToken(anchor, brief);
}

function canonicalTravelKey(key: string): string {
  return normalizedTripKey(key);
}

function travelGroupKey(entry: VaultEntry): string {
  const key = entryMetadataValue(entry, 'trip_key', 'tripKey', 'trip');
  return canonicalTravelKey(key || entry.project || entry.id || entry.path);
}

function travelGroupTitle(entry: VaultEntry): string {
  return entryMetadataValue(entry, 'trip_title', 'tripTitle') || entry.title;
}

function entryStartDate(entry: VaultEntry): string | null | undefined {
  return entry.start_date || entry.date || entry.due;
}

function entryEndDate(entry: VaultEntry): string | null | undefined {
  return entry.end_date || entry.date || entry.due || entry.start_date;
}

function overlapsUpcomingTravelWindow(entry: VaultEntry, today: Date): boolean {
  const start = parseEntryDate(entryStartDate(entry));
  if (!start) return false;
  const end = parseEntryDate(entryEndDate(entry)) || start;
  const windowStart = dayNumber(today) - 1;
  const windowEnd = dayNumber(addMonthsClamped(today, UPCOMING_TRAVEL_MONTHS));
  return dayNumber(end) >= windowStart && dayNumber(start) <= windowEnd;
}

function overlapsFutureTravelWindow(entry: VaultEntry, today: Date): boolean {
  const start = parseEntryDate(entryStartDate(entry));
  if (!start) return false;
  const end = parseEntryDate(entryEndDate(entry)) || start;
  const windowStart = dayNumber(today);
  const windowEnd = dayNumber(addMonthsClamped(today, UPCOMING_TRAVEL_MONTHS));
  return dayNumber(end) >= windowStart && dayNumber(start) <= windowEnd;
}

function minDate(values: Array<string | null | undefined>): string | null {
  const dates = values.filter(Boolean) as string[];
  return dates.length ? [...dates].sort()[0] : null;
}

function maxDate(values: Array<string | null | undefined>): string | null {
  const dates = values.filter(Boolean) as string[];
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return sorted[sorted.length - 1] || null;
}

function uniqueByPath(entries: VaultEntry[]): VaultEntry[] {
  const byPath = new Map<string, VaultEntry>();
  entries.forEach((entry) => {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
  });
  return [...byPath.values()];
}

function datedSortValue(entry: VaultEntry, today: Date): number {
  const days = daysUntil(entry.due || entry.date || entry.start_date, today);
  return days === null ? 9999 : days;
}

function priorityValue(entry: VaultEntry): number {
  const parsed = Number(String(entry.priority || 99).match(/\d+/)?.[0] || 99);
  return Number.isFinite(parsed) ? parsed : 99;
}

function sortTasks(entries: VaultEntry[], today: Date): VaultEntry[] {
  return [...entries].sort((a, b) => {
    const priorityDiff = priorityValue(a) - priorityValue(b);
    if (priorityDiff !== 0) return priorityDiff;
    const dateDiff = datedSortValue(a, today) - datedSortValue(b, today);
    return dateDiff !== 0 ? dateDiff : a.title.localeCompare(b.title);
  });
}

function closedPrimaryTaskBriefs(entries: VaultEntry[]): VaultEntry[] {
  return entries.filter((entry) => isTask(entry) && isTravelActionTask({ ...entry, status: 'open' }) && DONE_STATUSES.has(String(entry.status || '').toLowerCase()));
}

function primaryTasksForTrip(_groupKey: string, entries: VaultEntry[], today: Date): VaultEntry[] {
  const unique = uniqueByPath(entries);
  return sortTasks(unique, today).slice(0, 1);
}

export function parseLedgerRows(entry: VaultEntry): TravelLedgerItem[] {
  const rows = entry.properties?.ledger;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row))
    .map((row, index) => {
      const tripKey = scalarText(row.trip_key || row.trip || row.tripKey || row.trip_slug);
      const tripTitle = scalarText(row.trip_title || row.tripTitle || row.trip || tripKey || 'Travel item');
      const currency = (scalarText(row.currency) || 'USD').toUpperCase();
      const estimate = numericAmount(row.estimate ?? row.estimated ?? row.estimate_amount);
      const actual = numericAmount(row.actual ?? row.actual_amount ?? row.amount);
      const reimbursedAmount = numericAmount(row.reimbursed_amount ?? row.reimbursedAmount ?? row.reimbursement_amount);
      const coverageSource = scalarText(row.coverage_source ?? row.covered_by ?? row.funding_source ?? row.reimbursement_source ?? row.payer);
      const budgetAccount = scalarText(row.budget_account ?? row.budgetAccount ?? row.account);
      return {
        id: scalarText(row.id) || `${entry.path}:${index}`,
        tripKey: normalizedTripKey(tripKey || tripTitle) || `${entry.path}:${index}`,
        tripTitle: tripTitle || 'Travel item',
        item: scalarText(row.item || row.title) || 'Travel item',
        category: scalarText(row.category) || 'other',
        status: scalarText(row.status) || 'planned',
        date: scalarText(row.date || row.incurred_date || row.paid_date || row.transaction_date || row.submitted_date),
        reimbursable: booleanValue(row.reimbursable),
        coverageSource,
        budgetAccount,
        countsAgainstResearchAccount: ledgerRowCountsAgainstResearchAccount(row, coverageSource, budgetAccount),
        estimate,
        actual,
        estimateUsd: normalizedUsdAmount(estimate, row.estimate_usd ?? row.estimated_usd ?? row.estimateUsd, currency),
        actualUsd: normalizedUsdAmount(actual, row.actual_usd ?? row.actualUsd ?? row.amount_usd, currency),
        reimbursedAmount,
        reimbursedAmountUsd: normalizedUsdAmount(reimbursedAmount, row.reimbursed_amount_usd ?? row.reimbursedAmountUsd ?? row.reimbursement_amount_usd, currency),
        reimbursedDate: scalarText(row.reimbursed_date ?? row.reimbursedDate),
        currency,
        source: scalarText(row.source),
        receiptPointer: scalarText(row.receipt_pointer || row.receiptPointer),
        privatePointer: scalarText(row.private_pointer || row.privatePointer || row.detail_pointer || row.detailPointer),
        notePath: entry.path,
      };
    });
}

function buildLedger(entries: VaultEntry[]): { items: TravelLedgerItem[]; path: string | null; researchAccountLimitUsd: number } {
  const ledgerEntries = entries.filter((entry) => {
    const kind = String(entry.kind || entry.type || '').toLowerCase();
    return kind === 'travel-ledger';
  });
  const items = ledgerEntries.flatMap(parseLedgerRows);
  const limit = numericAmount(ledgerEntries[0]?.properties?.research_account_limit_usd ?? DEFAULT_RESEARCH_ACCOUNT_LIMIT_USD);
  return { items, path: ledgerEntries[0]?.path || null, researchAccountLimitUsd: limit || DEFAULT_RESEARCH_ACCOUNT_LIMIT_USD };
}

function groupTitle(key: string, fallback?: string): string {
  return fallback || key.replace(/-/g, ' ');
}

function createGroup(groups: Map<string, TravelGroup>, key: string, fallback?: string): TravelGroup {
  const existing = groups.get(key);
  if (existing) return existing;
  const group = { key, title: groupTitle(key, fallback), events: [], tasks: [], briefs: [], emailTemplates: [], ledgerItems: [] };
  groups.set(key, group);
  return group;
}

function ledgerGroupKey(item: TravelLedgerItem): string {
  return canonicalTravelKey(item.tripKey || item.tripTitle || item.id);
}

function tripLane(group: TravelGroup): TravelLaneId {
  const text = [
    group.title,
    ...group.tasks.map(entrySearchText),
    ...group.ledgerItems.map((item) => `${item.status} ${item.item} ${item.category}`),
  ].join(' ').toLowerCase();
  const hasLedgerStatus = (statuses: Set<string>) => group.ledgerItems.some((item) => statuses.has(item.status.toLowerCase()));
  const hasApprovalSignal = text.includes('approval') || hasLedgerStatus(LEDGER_STATUSES_NEED_APPROVAL);
  const hasActualReceiptWorkflow = group.ledgerItems.some((item) => (
    item.actual !== null ||
    item.actualUsd !== null ||
    item.reimbursedAmount !== null ||
    item.reimbursedAmountUsd !== null ||
    LEDGER_STATUSES_REIMBURSEMENT.has(item.status.toLowerCase())
  ));
  if (hasApprovalSignal && !hasActualReceiptWorkflow) return 'needs-approval';
  if (text.includes('reimbursement') || text.includes('receipt') || hasActualReceiptWorkflow) return 'reimbursement';
  if (hasApprovalSignal) return 'needs-approval';
  // Already booked, or local with no extra travel, belongs in Booked — checked
  // before the "needs booking" heuristic so a 'booked_*' status is not misread
  // as a booking action (the bare word "book" matches "booked").
  if (groupHasNoAdditionalTravel(group) || hasLedgerStatus(LEDGER_STATUSES_BOOKED)) return 'booked';
  if (text.includes('follow up') || text.includes('lead') || text.includes('tbd') || !group.events.length) return 'leads';
  if (/\bbook\b/.test(text) || text.includes('logistics') || text.includes('registration') || group.tasks.length > 0) return 'ready-book';
  if (group.events.length > 0) return 'booked';
  return 'leads';
}

function checklistForTrip(group: TravelGroup): TravelChecklistItem[] {
  const text = [
    group.title,
    ...group.tasks.map(entrySearchText),
    ...group.briefs.map(entrySearchText),
    ...group.ledgerItems.map((item) => `${item.item} ${item.category} ${item.status}`),
  ].join(' ').toLowerCase();
  const ledgerDone = (category: string) => group.ledgerItems.some((item) => {
    const status = item.status.toLowerCase();
    return item.category.toLowerCase().includes(category) && (LEDGER_STATUSES_BOOKED.has(status) || LEDGER_STATUSES_REIMBURSED.has(status));
  });
  const taskOpen = (terms: string[]) => group.tasks.some((task) => hasAnyTerm(entrySearchText(task), terms));
  return [
    {
      id: 'approval',
      label: 'Approval',
      state: text.includes('approval') ? 'blocked' : 'unknown',
    },
    {
      id: 'transport',
      label: 'Flights / transport',
      state: ledgerDone('transport') ? 'done' : taskOpen(['flight', 'transport', 'book']) ? 'open' : 'unknown',
    },
    {
      id: 'lodging',
      label: 'Lodging',
      state: ledgerDone('lodging') ? 'done' : taskOpen(['hotel', 'lodging']) ? 'open' : 'unknown',
    },
    {
      id: 'registration',
      label: 'Registration',
      state: ledgerDone('registration') || text.includes('registration is complete') || text.includes('registration was submitted') ? 'done' : taskOpen(['registration', 'rsvp']) ? 'open' : 'unknown',
    },
    {
      id: 'receipts',
      label: 'Receipts',
      state: group.ledgerItems.some((item) => item.receiptPointer) ? 'done' : taskOpen(['receipt', 'reimbursement']) ? 'open' : 'unknown',
    },
  ];
}

function normalizedStatus(value: string): string {
  return value.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function itemMatchesTravelKind(item: TravelLedgerItem, kind: 'flight' | 'hotel'): boolean {
  const text = `${item.category} ${item.item}`.toLowerCase();
  if (kind === 'flight') return /\b(flight|airfare|round trip|air transport)\b/.test(text);
  return /\b(hotel|lodging|accommodation|inn|room)\b/.test(text);
}

function groupHasNoAdditionalTravel(group: TravelGroup): boolean {
  return group.ledgerItems.some((item) => LEDGER_STATUSES_NOT_NEEDED.has(item.status.toLowerCase()) || LEDGER_STATUSES_NOT_NEEDED.has(normalizedStatus(item.status)));
}

function itineraryReadiness(group: TravelGroup): TravelReadinessItem {
  if (groupHasNoAdditionalTravel(group)) {
    return {
      id: 'itinerary',
      label: 'Itinerary',
      state: 'not-needed',
      detail: 'Local / no extra travel',
    };
  }
  const briefText = group.briefs.map(entrySearchText).join(' ');
  const hasBrief = group.briefs.length > 0;
  const hasSpecificOptions = /book-ready itinerary|specific options|hotel shortlist|routing|booking brief|logistics/.test(briefText);
  const hasFlightAndHotel = /(flight|airfare|round trip|routing)/.test(briefText)
    && /(hotel|lodging|accommodation|room)/.test(briefText);
  if (hasBrief && (hasSpecificOptions || hasFlightAndHotel)) {
    return {
      id: 'itinerary',
      label: 'Itinerary',
      state: 'done',
      detail: hasFlightAndHotel ? 'Suggested flights + hotels' : 'Brief ready',
    };
  }
  if (hasBrief) {
    return {
      id: 'itinerary',
      label: 'Itinerary',
      state: 'open',
      detail: 'Brief needs options',
    };
  }
  return {
    id: 'itinerary',
    label: 'Itinerary',
    state: 'unknown',
    detail: 'No brief found',
  };
}

function bookingReadiness(group: TravelGroup, kind: 'flight' | 'hotel'): TravelReadinessItem {
  const label = kind === 'flight' ? 'Flights' : 'Hotel';
  if (groupHasNoAdditionalTravel(group)) {
    return {
      id: kind === 'flight' ? 'flights' : 'hotel',
      label,
      state: 'not-needed',
      detail: 'Not needed',
    };
  }
  const items = group.ledgerItems.filter((item) => itemMatchesTravelKind(item, kind));
  if (items.some((item) => LEDGER_STATUSES_BOOKED.has(item.status.toLowerCase()) || LEDGER_STATUSES_BOOKED.has(normalizedStatus(item.status)))) {
    return {
      id: kind === 'flight' ? 'flights' : 'hotel',
      label,
      state: 'done',
      detail: 'Booked',
    };
  }
  if (items.some((item) => LEDGER_STATUSES_NEED_APPROVAL.has(item.status.toLowerCase()) || LEDGER_STATUSES_NEED_APPROVAL.has(normalizedStatus(item.status)))) {
    return {
      id: kind === 'flight' ? 'flights' : 'hotel',
      label,
      state: 'waiting',
      detail: 'Awaiting approval',
    };
  }
  if (items.some((item) => item.estimate !== null || item.estimateUsd !== null)) {
    return {
      id: kind === 'flight' ? 'flights' : 'hotel',
      label,
      state: 'open',
      detail: 'Suggested, not booked',
    };
  }
  if (group.ledgerItems.some((item) => item.actual !== null || item.actualUsd !== null || Boolean(item.receiptPointer))) {
    return {
      id: kind === 'flight' ? 'flights' : 'hotel',
      label,
      state: 'unknown',
      detail: 'Not tracked',
    };
  }
  const taskText = group.tasks.map(entrySearchText).join(' ');
  if (kind === 'flight' && /\b(flight|airfare|routing)\b/.test(taskText)) {
    return { id: 'flights', label, state: 'open', detail: 'Needs booking' };
  }
  if (kind === 'hotel' && /\b(hotel|lodging|accommodation)\b/.test(taskText)) {
    return { id: 'hotel', label, state: 'open', detail: 'Needs booking' };
  }
  return {
    id: kind === 'flight' ? 'flights' : 'hotel',
    label,
    state: 'unknown',
    detail: 'Not tracked',
  };
}

function reimbursementReadiness(group: TravelGroup): TravelReadinessItem {
  if (groupHasNoAdditionalTravel(group)) {
    return {
      id: 'reimbursement',
      label: 'Reimburse',
      state: 'not-needed',
      detail: 'No expense expected',
    };
  }
  const reimbursableItems = group.ledgerItems.filter((item) => item.reimbursable && (
    item.actual !== null || item.actualUsd !== null || Boolean(item.receiptPointer) || item.status.toLowerCase().includes('reimbursement')
  ));
  if (reimbursableItems.length === 0) {
    return {
      id: 'reimbursement',
      label: 'Reimburse',
      state: 'unknown',
      detail: 'No actuals yet',
    };
  }
  if (reimbursableItems.some((item) => normalizedStatus(item.status).includes('needs submission check'))) {
    return {
      id: 'reimbursement',
      label: 'Reimburse',
      state: 'open',
      detail: 'Receipt check needed',
    };
  }
  if (reimbursableItems.every((item) => LEDGER_STATUSES_REIMBURSED.has(item.status.toLowerCase()) || LEDGER_STATUSES_REIMBURSED.has(normalizedStatus(item.status)))) {
    return {
      id: 'reimbursement',
      label: 'Reimburse',
      state: 'done',
      detail: 'Received',
    };
  }
  if (reimbursableItems.some((item) => LEDGER_STATUSES_PENDING_REIMBURSEMENT.has(item.status.toLowerCase()) || LEDGER_STATUSES_PENDING_REIMBURSEMENT.has(normalizedStatus(item.status)))) {
    return {
      id: 'reimbursement',
      label: 'Reimburse',
      state: 'waiting',
      detail: 'Submitted / pending',
    };
  }
  return {
    id: 'reimbursement',
    label: 'Reimburse',
    state: 'open',
    detail: 'Needs submission',
  };
}

function readinessForTrip(group: TravelGroup): TravelReadinessItem[] {
  return [
    itineraryReadiness(group),
    bookingReadiness(group, 'flight'),
    bookingReadiness(group, 'hotel'),
    reimbursementReadiness(group),
  ];
}

function travelAnchor(group: TravelGroup): VaultEntry {
  const project = group.briefs[0]?.project || group.tasks[0]?.project || group.events[0]?.project || null;
  const ledgerAnchor = group.ledgerItems[0] ? ({
    path: group.ledgerItems[0].notePath,
    filename: group.ledgerItems[0].notePath.split('/').pop() || 'travel_ledger.md',
    title: group.title,
    kind: 'travel-ledger',
    project,
    private: false,
  } satisfies VaultEntry) : null;
  return group.briefs[0] || group.tasks[0] || group.events[0] || ledgerAnchor || {
    path: `travel:${group.key}`,
    filename: `${group.key}.md`,
    title: group.title,
    kind: 'travel',
    project,
    private: false,
  };
}

function sumUsdAmounts(items: TravelLedgerItem[], field: 'estimateUsd' | 'actualUsd' | 'reimbursedAmountUsd'): number {
  return items.reduce((sum, item) => sum + (item[field] || 0), 0);
}

function ledgerStatusSetHas(statuses: Set<string>, status: string): boolean {
  return statuses.has(status.toLowerCase()) || statuses.has(normalizedStatus(status));
}

function isYtdLedgerItem(item: TravelLedgerItem, today: Date): boolean {
  if (item.actualUsd === null) return false;
  const parsed = parseEntryDate(item.date);
  if (!parsed) return true;
  return parsed.getFullYear() === today.getFullYear() && dayNumber(parsed) <= dayNumber(today);
}

function isPlannedLedgerItem(item: TravelLedgerItem): boolean {
  if (item.estimateUsd === null || item.estimateUsd <= 0) return false;
  if (item.actualUsd !== null) return false;
  if (ledgerStatusSetHas(LEDGER_STATUSES_NOT_NEEDED, item.status)) return false;
  if (ledgerStatusSetHas(LEDGER_STATUSES_REIMBURSED, item.status)) return false;
  return true;
}

function ytdItems(items: TravelLedgerItem[], today: Date): TravelLedgerItem[] {
  return items.filter((item) => isYtdLedgerItem(item, today));
}

function plannedItems(items: TravelLedgerItem[]): TravelLedgerItem[] {
  return items.filter(isPlannedLedgerItem);
}

function researchAccountItems(items: TravelLedgerItem[]): TravelLedgerItem[] {
  return items.filter((item) => item.countsAgainstResearchAccount);
}

function reimbursedUsd(items: TravelLedgerItem[]): number {
  return items.reduce((sum, item) => {
    if (!ledgerStatusSetHas(LEDGER_STATUSES_REIMBURSED, item.status)) return sum;
    return sum + (item.reimbursedAmountUsd || 0);
  }, 0);
}

function pendingExpectedReimbursementUsd(items: TravelLedgerItem[]): number {
  return items.reduce((sum, item) => {
    if (!item.reimbursable || !ledgerStatusSetHas(LEDGER_STATUSES_PENDING_REIMBURSEMENT, item.status)) return sum;
    const actual = item.actualUsd || 0;
    const alreadyReimbursed = item.reimbursedAmountUsd || 0;
    return sum + Math.max(0, actual - alreadyReimbursed);
  }, 0);
}

function outOfPocketUsd(items: TravelLedgerItem[]): number {
  return Math.max(0, sumUsdAmounts(items, 'actualUsd') - reimbursedUsd(items));
}

function expectedNetUsd(items: TravelLedgerItem[]): number {
  return Math.max(0, outOfPocketUsd(items) - pendingExpectedReimbursementUsd(items));
}

function statusLabelForTrip(group: TravelGroup, lane: TravelLaneId): string {
  if (group.ledgerItems.some((item) => item.actual !== null)) return 'actuals tracked';
  if (group.ledgerItems.some((item) => item.estimate !== null)) return 'estimate tracked';
  return LANE_LABELS[lane].toLowerCase();
}

function buildTrip(group: TravelGroup, today: Date): TravelTrip {
  const events = [...group.events].sort((a, b) => datedSortValue(a, today) - datedSortValue(b, today) || a.title.localeCompare(b.title));
  const tasks = primaryTasksForTrip(group.key, group.tasks, today);
  const briefs = uniqueByPath(group.briefs).sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0)).slice(0, 4);
  const emailTemplates = uniqueByPath(group.emailTemplates).sort((a, b) => a.title.localeCompare(b.title)).slice(0, 3);
  const anchor = travelAnchor({ ...group, events, tasks, briefs, emailTemplates });
  const lane = tripLane({ ...group, events, tasks, briefs });
  const title = group.title;
  return {
    key: group.key === anchor.path ? anchor.path : `travel:${group.key}`,
    title,
    project: anchor.project,
    kind: String(anchor.type || anchor.kind || entryLens(anchor) || 'travel'),
    startDate: minDate(events.map(entryStartDate)),
    endDate: maxDate(events.map(entryEndDate)),
    anchor,
    missing: tasks,
    briefs,
    events,
    ledgerItems: group.ledgerItems,
    emailTemplates,
    lane,
    laneLabel: LANE_LABELS[lane],
    checklist: checklistForTrip({ ...group, events, tasks, briefs }),
    readiness: readinessForTrip({ ...group, events, tasks, briefs }),
    totalEstimate: sumUsdAmounts(group.ledgerItems, 'estimateUsd'),
    totalActual: sumUsdAmounts(group.ledgerItems, 'actualUsd'),
    unreimbursedActual: outOfPocketUsd(group.ledgerItems),
    plannedEstimate: sumUsdAmounts(plannedItems(group.ledgerItems), 'estimateUsd'),
    ytdActual: sumUsdAmounts(ytdItems(group.ledgerItems, today), 'actualUsd'),
    statusLabel: statusLabelForTrip(group, lane),
  };
}

function isVisibleUpcomingTrip(trip: TravelTrip, today: Date): boolean {
  if (trip.events.some((event) => overlapsUpcomingTravelWindow(event, today))) return true;
  return trip.missing.some((task) => overlapsUpcomingTravelWindow(task, today));
}

function isVisibleTravelCenterTrip(trip: TravelTrip, today: Date): boolean {
  if (trip.missing.length > 0 || trip.ledgerItems.length > 0) return true;
  if (trip.briefs.length > 0 && trip.events.some((event) => overlapsFutureTravelWindow(event, today))) return true;
  return trip.events.some((event) => overlapsFutureTravelWindow(event, today));
}

// A trip is complete once it is in the past with nothing left to manage: no open
// owned tasks, no current or future event window, and every tracked ledger row
// settled (reimbursed/paid/complete/done/not-needed). Completed trips drop off
// the active board — they are neither "booked / upcoming" nor pending
// reimbursement — while their ledger rows remain in the accounting view.
function isCompletedTrip(trip: TravelTrip, today: Date): boolean {
  if (trip.missing.length > 0) return false;
  if (trip.ledgerItems.length === 0) return false;
  const everyStatusIn = (statuses: Set<string>) => trip.ledgerItems.every((item) => (
    statuses.has(item.status.toLowerCase()) || statuses.has(normalizedStatus(item.status))
  ));
  if (!everyStatusIn(LEDGER_STATUSES_SETTLED)) return false;
  // A cancelled trip is closed even if its (now-moot) event window is still
  // ahead — it isn't happening, so it shouldn't sit in an active lane.
  if (everyStatusIn(LEDGER_STATUSES_CANCELLED)) return true;
  // Otherwise (reimbursed / host-paid / local) keep it while its window is ahead.
  if (trip.events.some((event) => overlapsFutureTravelWindow(event, today))) return false;
  return true;
}

function buildSummary(trips: TravelTrip[], ledgerItems: TravelLedgerItem[], today: Date, researchAccountLimitUsd = DEFAULT_RESEARCH_ACCOUNT_LIMIT_USD): TravelCenterSummary {
  const ytdLedgerItems = ytdItems(ledgerItems, today);
  const futurePlannedItems = plannedItems(ledgerItems);
  const plannedUsd = sumUsdAmounts(futurePlannedItems, 'estimateUsd');
  const ytdActualUsd = sumUsdAmounts(ytdLedgerItems, 'actualUsd');
  const ytdReimbursedUsd = reimbursedUsd(ytdLedgerItems);
  const ytdOutOfPocketUsd = Math.max(0, ytdActualUsd - ytdReimbursedUsd);
  const researchYtdItems = researchAccountItems(ytdLedgerItems);
  const researchPlannedItems = researchAccountItems(futurePlannedItems);
  const researchAccountYtdActualUsd = sumUsdAmounts(researchYtdItems, 'actualUsd');
  const researchAccountYtdReimbursedUsd = reimbursedUsd(researchYtdItems);
  const researchAccountPlannedUsd = sumUsdAmounts(researchPlannedItems, 'estimateUsd');
  const researchAccountYtdPlusPlannedUsd = researchAccountYtdActualUsd + researchAccountPlannedUsd;
  const researchAccountRemainingAfterPlannedUsd = Math.max(0, researchAccountLimitUsd - researchAccountYtdPlusPlannedUsd);
  const researchAccountOverPlannedUsd = Math.max(0, researchAccountYtdPlusPlannedUsd - researchAccountLimitUsd);
  const researchAccountUsedPct = researchAccountLimitUsd > 0 ? (researchAccountYtdPlusPlannedUsd / researchAccountLimitUsd) * 100 : 0;
  const nextTrip = trips
    .filter((trip) => trip.startDate && (daysUntil(trip.startDate, today) ?? 9999) >= -1)
    .sort((a, b) => (daysUntil(a.startDate, today) ?? 9999) - (daysUntil(b.startDate, today) ?? 9999))[0] || null;
  const urgentBlocker = sortTasks(trips.flatMap((trip) => trip.missing), today)
    .find((task) => {
      const days = daysUntil(task.due || task.date || task.start_date, today);
      return days !== null && days <= 14;
    }) || null;
  return {
    nextTrip,
    urgentBlocker,
    approvalNeeded: trips.filter((trip) => trip.lane === 'needs-approval').length,
    bookedUpcoming: trips.filter((trip) => trip.lane === 'booked').length,
    reimbursementItems: trips.filter((trip) => trip.lane === 'reimbursement').length,
    totalEstimate: sumUsdAmounts(ledgerItems, 'estimateUsd'),
    totalActual: sumUsdAmounts(ledgerItems, 'actualUsd'),
    unreimbursedActual: outOfPocketUsd(ledgerItems),
    grossActualUsd: sumUsdAmounts(ledgerItems, 'actualUsd'),
    reimbursedUsd: reimbursedUsd(ledgerItems),
    outOfPocketUsd: outOfPocketUsd(ledgerItems),
    expectedNetUsd: expectedNetUsd(ledgerItems),
    pendingExpectedReimbursementUsd: pendingExpectedReimbursementUsd(ledgerItems),
    ytdActualUsd,
    ytdReimbursedUsd,
    ytdOutOfPocketUsd,
    plannedUsd,
    plannedReimbursableUsd: sumUsdAmounts(futurePlannedItems.filter((item) => item.reimbursable), 'estimateUsd'),
    ytdPlusPlannedUsd: ytdActualUsd + plannedUsd,
    researchAccountLimitUsd,
    researchAccountYtdActualUsd,
    researchAccountYtdReimbursedUsd,
    researchAccountYtdPendingUsd: pendingExpectedReimbursementUsd(researchYtdItems),
    researchAccountPlannedUsd,
    researchAccountYtdPlusPlannedUsd,
    researchAccountRemainingAfterPlannedUsd,
    researchAccountOverPlannedUsd,
    researchAccountUsedPct,
  };
}

function uniqueCalendarEventsByTrip(events: VaultEntry[], today: Date): VaultEntry[] {
  const byTrip = new Map<string, VaultEntry>();
  for (const event of events) {
    const key = travelGroupKey(event);
    const existing = byTrip.get(key);
    if (!existing || datedSortValue(event, today) < datedSortValue(existing, today)) {
      byTrip.set(key, event);
    }
  }
  return [...byTrip.values()].sort((a, b) => datedSortValue(a, today) - datedSortValue(b, today) || a.title.localeCompare(b.title));
}

export function buildTravelCenter(entries: VaultEntry[], openTasks?: VaultEntry[], today = new Date()): TravelCenterData {
  const tasks = openTasks ? openTasks.filter(isTravelActionTask) : entries.filter(isTravelActionTask);
  const briefs = uniqueByPath([...entries.filter(isTravelBrief), ...closedPrimaryTaskBriefs(entries)]);
  const emailTemplates = uniqueByPath(entries.filter(isTravelEmailTemplate));
  const allEvents = entries.filter(isTravelEvent);
  const calendarEvents = uniqueCalendarEventsByTrip(allEvents.filter((entry) => (
    isTravelStripEvent(entry) && overlapsFutureTravelWindow(entry, today)
  )), today);
  const ledger = buildLedger(entries);
  const groups = new Map<string, TravelGroup>();

  for (const event of allEvents) {
    createGroup(groups, travelGroupKey(event), travelGroupTitle(event)).events.push(event);
  }
  for (const task of tasks) {
    const key = travelGroupKey(task);
    createGroup(groups, key, travelGroupTitle(task)).tasks.push(task);
  }
  for (const brief of briefs) {
    const key = travelGroupKey(brief);
    if (groups.has(key) || key !== brief.path) createGroup(groups, key, travelGroupTitle(brief)).briefs.push(brief);
  }
  for (const item of ledger.items) {
    const key = ledgerGroupKey(item);
    createGroup(groups, key, item.tripTitle).ledgerItems.push(item);
  }

  for (const group of groups.values()) {
    for (const brief of briefs) {
      if (!group.briefs.some((entry) => entry.path === brief.path) && group.events.some((event) => relatedTravelBrief(event, brief))) {
        group.briefs.push(brief);
      }
    }
    for (const template of emailTemplates) {
      if (!group.emailTemplates.some((entry) => entry.path === template.path) && travelTokens(template).has(group.key)) {
        group.emailTemplates.push(template);
      }
    }
  }

  const trips = [...groups.values()]
    .map((group) => buildTrip(group, today))
    .filter((trip) => isVisibleTravelCenterTrip(trip, today) && !isCompletedTrip(trip, today))
    .sort((a, b) => {
      const laneDiff = LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane);
      const dateDiff = (daysUntil(a.startDate, today) ?? 9999) - (daysUntil(b.startDate, today) ?? 9999);
      return dateDiff !== 0 ? dateDiff : laneDiff !== 0 ? laneDiff : a.title.localeCompare(b.title);
    });
  const lanes = LANE_ORDER.map((id) => ({
    id,
    title: LANE_LABELS[id],
    detail: LANE_DETAILS[id],
    trips: trips.filter((trip) => trip.lane === id),
  }));
  const upcomingTravel = trips
    .filter((trip) => isVisibleUpcomingTrip(trip, today))
    .map((trip) => ({
      key: trip.key,
      title: trip.title,
      project: trip.project,
      kind: trip.kind,
      startDate: trip.startDate,
      endDate: trip.endDate,
      anchor: trip.anchor,
      missing: trip.missing,
      briefs: trip.briefs,
    }))
    .slice(0, 8);

  return {
    trips,
    lanes,
    ledgerItems: ledger.items,
    summary: buildSummary(trips, ledger.items, today, ledger.researchAccountLimitUsd),
    upcomingTravel,
    calendarItems: calendarEvents,
    submissions: buildSubmissions(entries, today),
    ledgerPath: ledger.path,
  };
}

export function buildUpcomingTravel(entries: VaultEntry[], openTasks: VaultEntry[], today = new Date()): OverviewTravelItem[] {
  return buildTravelCenter(entries, openTasks, today).upcomingTravel;
}
