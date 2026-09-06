import { SignJWT, jwtVerify } from 'jose';

const ALG = 'HS256';
const TTL_SECONDS = 8 * 60 * 60;

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(
  secret: string,
  u: { id: number; username: string; role: string; tv: number },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ username: u.username, role: u.role, tv: u.tv })
    .setProtectedHeader({ alg: ALG })
    .setSubject(String(u.id))
    .setIssuedAt(now)
    .setExpirationTime(now + TTL_SECONDS)
    .sign(key(secret));
}

export async function verifySession(
  secret: string,
  token: string,
): Promise<{ sub: number; username: string; role: 'owner' | 'editor'; tv: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: [ALG] });
    const sub = Number(payload.sub);
    const role = payload.role;
    if (!Number.isInteger(sub)) return null;
    if (role !== 'owner' && role !== 'editor') return null;
    return { sub, username: String(payload.username ?? ''), role, tv: Number(payload.tv ?? 0) };
  } catch {
    return null;
  }
}
