export type UserRole = 'student' | 'staff' | 'admin';

export type IssueCategory =
  | 'hardware'
  | 'electrical'
  | 'plumbing'
  | 'network'
  | 'furniture'
  | 'cleanliness'
  | 'safety'
  | 'other';

export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export type TicketStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'closed'
  | 'rejected';

export type TicketEventType =
  | 'reported'
  | 'claimed'
  | 'status_changed'
  | 'comment';

export type MaintenanceStatus = 'scheduled' | 'completed' | 'cancelled';

/** Statuses that still occupy the "one active ticket per facility+category" slot. */
export const ACTIVE_TICKET_STATUSES: readonly TicketStatus[] = [
  'open',
  'assigned',
  'in_progress',
];

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface Facility {
  id: string;
  name: string;
  building: string;
}

export interface Ticket {
  id: string;
  facilityId: string;
  reportedBy: string;
  assignedTo: string | null;
  category: IssueCategory;
  priority: TicketPriority;
  title: string;
  description: string;
  status: TicketStatus;
  affectedCount: number;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface NewTicket {
  facilityId: string;
  reportedBy: string;
  category: IssueCategory;
  priority: TicketPriority;
  title: string;
  description: string;
}

export interface TicketEvent {
  id: string;
  ticketId: string;
  actorId: string | null;
  eventType: TicketEventType;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  note: string | null;
  createdAt: Date;
}

/** A ticket together with its append-only audit trail. */
export interface TicketDetail extends Ticket {
  timeline: TicketEvent[];
}

export interface MaintenanceWindow {
  id: string;
  facilityId: string;
  scheduledBy: string;
  startTime: Date;
  endTime: Date;
  note: string | null;
  status: MaintenanceStatus;
}

export interface NewMaintenanceWindow {
  facilityId: string;
  scheduledBy: string;
  startTime: Date;
  endTime: Date;
  note?: string;
}

export interface TicketFilters {
  facilityId?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: IssueCategory;
  reportedBy?: string;
  assignedTo?: string;
}
