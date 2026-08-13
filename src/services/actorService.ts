import { findUserById } from '../data/userData';
import { forbidden, notFound } from '../errors';
import type { User } from '../types';

/**
 * Who is performing an action.
 *
 * There is no authentication in this project, so the caller supplies an
 * `actorId` and the service verifies what that user is allowed to do. This
 * establishes the authorisation *rules* while leaving authentication out of
 * scope; a real deployment would take the id from a verified session instead of
 * from the request body. See the Limitations section of the README.
 */
export async function requireUser(id: string): Promise<User> {
  const user = await findUserById(id);
  if (!user) {
    throw notFound('ACTOR_NOT_FOUND', 'The acting user does not exist.');
  }
  return user;
}

/** Claiming, resolving and scheduling maintenance are staff operations. */
export async function requireStaff(id: string): Promise<User> {
  const user = await requireUser(id);
  if (user.role !== 'staff' && user.role !== 'admin') {
    throw forbidden(
      'ACTOR_NOT_STAFF',
      'Only maintenance staff may perform this action.',
    );
  }
  return user;
}
