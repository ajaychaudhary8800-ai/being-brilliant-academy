import type { APIRequestContext } from "@playwright/test";
import { account, organization, type QaRole } from "./environment";

export type QaApiSession = {
  role: QaRole;
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: string; organizationId: string };
  organization: { id: string; slug: string; name: string };
};

async function responseError(response: Awaited<ReturnType<APIRequestContext["fetch"]>>) {
  const body = await response.text();
  return `${response.status()} ${response.statusText()}: ${body.slice(0, 1200)}`;
}

export async function loginApi(request: APIRequestContext, role: QaRole): Promise<QaApiSession> {
  const credentials = account(role);
  const response = await request.post("/api/v1/auth/login", {
    data: {
      organization,
      email: credentials.email,
      password: credentials.password,
      portal: credentials.portal,
      rememberMe: false,
    },
  });
  if (!response.ok()) throw new Error(`API login failed for ${role}: ${await responseError(response)}`);
  const payload = await response.json() as { data: Omit<QaApiSession, "role"> };
  return { role, ...payload.data };
}

export async function apiJson<T>(
  request: APIRequestContext,
  session: QaApiSession,
  path: string,
  options: { method?: string; data?: unknown } = {},
): Promise<T> {
  const response = await request.fetch(path, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(options.data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.data === undefined ? {} : { data: options.data }),
  });
  if (!response.ok()) throw new Error(`${session.role} ${options.method ?? "GET"} ${path} failed: ${await responseError(response)}`);
  return await response.json() as T;
}
