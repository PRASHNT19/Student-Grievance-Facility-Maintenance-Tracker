const API_BASE_URL = "/api";

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const headers = new Headers(options.headers);

  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.error || "Something went wrong"
    );
  }

  return data;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: "student" | "staff" | "admin";
}

export interface Grievance {
  id: string;
  studentId: string;
  title: string;
  description: string;
  category: string;
  location: string | null;
  status:
    | "OPEN"
    | "IN_PROGRESS"
    | "RESOLVED"
    | "REJECTED";
  createdAt: string;
  updatedAt: string;
}

export async function login(
  email: string,
  password: string
) {
  const result = await request<{
    user: User;
    token: string;
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
    }),
  });

  localStorage.setItem("auth_token", result.token);

  return result;
}

export async function register(
  name: string,
  email: string,
  password: string
) {
  const result = await request<{
    user: User;
    token: string;
  }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name,
      email,
      password,
    }),
  });

  localStorage.setItem("auth_token", result.token);

  return result;
}

export async function getCurrentUser() {
  return request<{ user: User }>("/auth/me");
}

export async function getMyGrievances() {
  return request<{ grievances: Grievance[] }>(
    "/grievances/mine"
  );
}

export async function createGrievance(data: {
  title: string;
  description: string;
  category: string;
  location?: string;
}) {
  return request<{ grievance: Grievance }>(
    "/grievances",
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  );
}

export async function getAllGrievances() {
  return request<{ grievances: Grievance[] }>(
    "/grievances"
  );
}

export async function updateGrievanceStatus(
  id: string,
  status: Grievance["status"]
) {
  return request<{ grievance: Grievance }>(
    `/grievances/${id}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }
  );
}

export function logout() {
  localStorage.removeItem("auth_token");
}