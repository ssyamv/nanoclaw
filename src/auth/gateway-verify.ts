export interface VerifiedContext {
  userId: number;
  workspaceId: number;
  displayName: string;
  expiresAt: number;
}

/**
 * Call Gateway POST /auth/verify to resolve an arcflow_token into user context.
 * Throws Error('AUTH_EXPIRED') / Error('AUTH_INVALID') / Error('GATEWAY_UNREACHABLE').
 */
export async function verifyViaGateway(
  gatewayUrl: string,
  token: string,
): Promise<VerifiedContext> {
  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/auth/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('GATEWAY_UNREACHABLE');
  }
  const json = (await res.json().catch(() => ({}))) as {
    code?: number | string;
    data?: VerifiedContext;
  };
  if (res.status === 200 && json.code === 0 && json.data) {
    return json.data;
  }
  if (res.status === 401 && json.code === 'AUTH_EXPIRED') {
    throw new Error('AUTH_EXPIRED');
  }
  throw new Error('AUTH_INVALID');
}
