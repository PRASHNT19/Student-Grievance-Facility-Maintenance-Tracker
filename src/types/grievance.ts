export type GrievanceStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";

export interface Grievance {
  id: string;
  studentId: string;
  title: string;
  description: string;
  category: string;
  location: string | null;
  status: GrievanceStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateGrievanceInput {
  studentId: string;
  title: string;
  description: string;
  category: string;
  location?: string;
}
