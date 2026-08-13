import {
  addTicketComment,
  addAffectedUser,
} from "../data/ticketData";

export async function commentOnTicket(
  ticketId: string,
  actorId: string,
  note: string
) {
  if (!note || note.trim().length === 0) {
    throw new Error("Comment cannot be empty");
  }

  if (note.length > 2000) {
    throw new Error(
      "Comment cannot exceed 2000 characters"
    );
  }

  return addTicketComment(
    ticketId,
    actorId,
    note.trim()
  );
}

export async function registerAffectedUser(
  ticketId: string,
  actorId: string
) {
  const result = await addAffectedUser(
    ticketId,
    actorId
  );

  return {
    registered: result !== null,
  };
}