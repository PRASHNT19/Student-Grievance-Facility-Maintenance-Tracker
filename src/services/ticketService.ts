import {
  insertTicket,
  findTicketById,
  listTickets,
  listTicketEvents,
  claimTicket,
  changeTicketStatus,
  addComment,
  markAffected,
} from '../data/ticketData';
import { requireFacility } from './facilityService';
import { requireStaff, requireUser } from './actorService';
import { conflict, notFound } from '../errors';
import { ACTIVE_TICKET_STATUSES } from '../types';
import type {
  IssueCategory,
  Ticket,
  TicketDetail,
  TicketEvent,
  TicketFilters,
  TicketPriority,
  TicketStatus,
} from '../types';

export interface ReportIssueInput {
  facilityId: string;
  reportedBy: string;
  category: IssueCategory;
  priority: TicketPriority;
  title: string;
  description: string;
}

/**
 * The ticket lifecycle, as a table rather than a chain of if-statements.
 *
 * `open -> assigned` is deliberately absent: a ticket becomes assigned only
 * through POST /tickets/:id/claim, which sets the assignee in the same
 * statement. Allowing it here would let a caller mark a ticket assigned with
 * nobody assigned to it.
 */
const ALLOWED_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['rejected'],
  assigned: ['in_progress', 'open', 'rejected'],
  in_progress: ['resolved', 'assigned'],
  resolved: ['closed', 'in_progress'],
  closed: [],
  rejected: [],
};

const isActive = (status: TicketStatus): boolean =>
  ACTIVE_TICKET_STATUSES.includes(status);

/**
 * Reports a campus issue.
 *
 * The checks below are referential validation -- they let the API answer "that
 * facility id does not exist" with a 404 instead of a database error. They are
 * deliberately NOT a duplicate check: nothing here asks whether an active
 * ticket already covers this facility and category. That is decided by the
 * `tickets_one_active_per_issue` index inside insertTicket's single INSERT, so
 * no gap exists between "check" and "insert" for a competing report to slip
 * through.
 */
export async function reportIssue(input: ReportIssueInput): Promise<Ticket> {
  await requireFacility(input.facilityId);
  await requireUser(input.reportedBy);

  return insertTicket({
    facilityId: input.facilityId,
    reportedBy: input.reportedBy,
    category: input.category,
    priority: input.priority,
    title: input.title.trim(),
    description: input.description.trim(),
  });
}

export function getTickets(filters: TicketFilters): Promise<Ticket[]> {
  return listTickets(filters);
}

export async function getTicketsForFacility(
  facilityId: string,
  filters: Omit<TicketFilters, 'facilityId'> = {},
): Promise<Ticket[]> {
  await requireFacility(facilityId);
  return listTickets({ ...filters, facilityId });
}

/** A ticket together with its full audit trail. */
export async function getTicketDetail(id: string): Promise<TicketDetail> {
  const ticket = await requireTicket(id);
  const timeline = await listTicketEvents(id);
  return { ...ticket, timeline };
}

/**
 * Claims an open ticket for a staff member.
 *
 * No "is it already claimed?" check happens here. The guarded UPDATE in
 * claimTicket is the check, so two staff members clicking Claim at the same
 * instant produce exactly one 200 and one 409.
 */
export async function claimTicketForStaff(
  id: string,
  actorId: string,
): Promise<Ticket> {
  await requireStaff(actorId);

  const claimed = await claimTicket(id, actorId);
  if (claimed) return claimed;

  // The UPDATE matched nothing. Work out which of the three reasons applies so
  // the client gets a useful status instead of a bare failure.
  const existing = await findTicketById(id);
  if (!existing) {
    throw notFound('TICKET_NOT_FOUND', 'Ticket not found.');
  }
  if (existing.assignedTo) {
    throw conflict(
      'TICKET_ALREADY_CLAIMED',
      'Another staff member has already claimed this ticket.',
      { assignedTo: existing.assignedTo, status: existing.status },
    );
  }
  throw conflict(
    'TICKET_NOT_OPEN',
    `Only an open ticket can be claimed; this one is ${existing.status}.`,
  );
}

export async function updateTicketStatus(
  id: string,
  actorId: string,
  nextStatus: TicketStatus,
  note?: string,
): Promise<Ticket> {
  await requireStaff(actorId);
  const ticket = await requireTicket(id);

  const allowed = ALLOWED_TRANSITIONS[ticket.status];
  if (!allowed.includes(nextStatus)) {
    throw conflict(
      'INVALID_TRANSITION',
      `A ticket cannot move from ${ticket.status} to ${nextStatus}.`,
      { from: ticket.status, to: nextStatus, allowed },
    );
  }

  const updated = await changeTicketStatus(
    id,
    actorId,
    ticket.status,
    nextStatus,
    note,
  );

  // The UPDATE was conditional on the status this function just read. A null
  // result means a competing request moved the ticket in between, so the
  // transition decided above is stale and must not be forced through.
  if (!updated) {
    throw conflict(
      'TICKET_STATUS_CHANGED',
      'The ticket changed status while this request was being processed. Re-read it and try again.',
    );
  }

  return updated;
}

/** Students and staff alike may comment; the comment is appended to the trail. */
export async function commentOnTicket(
  id: string,
  actorId: string,
  note: string,
): Promise<TicketEvent> {
  await requireUser(actorId);
  await requireTicket(id);
  return addComment(id, actorId, note.trim());
}

/**
 * "This affects me too."
 *
 * This is the other half of duplicate suppression: because the index refuses a
 * second active ticket for the same issue, students who would have filed one
 * register here instead, and the scale of the problem is still recorded.
 */
export async function registerAffected(
  id: string,
  userId: string,
): Promise<Ticket> {
  await requireUser(userId);
  const ticket = await requireTicket(id);

  if (!isActive(ticket.status)) {
    throw conflict(
      'TICKET_NOT_ACTIVE',
      `This ticket is ${ticket.status}; report a new one if the problem persists.`,
    );
  }

  return markAffected(id, userId);
}

async function requireTicket(id: string): Promise<Ticket> {
  const ticket = await findTicketById(id);
  if (!ticket) {
    throw notFound('TICKET_NOT_FOUND', 'Ticket not found.');
  }
  return ticket;
}
