import jwt from 'jsonwebtoken';

export interface AdminJwtPayload {
  sub: string;
  iat: number;
  exp: number;
  jti?: string;
}

export function getAdminJwtSecret(): string {
  return process.env.ADMIN_JWT_SECRET || 'jimeng-api-admin-secret';
}

export function verifyAdminToken(token: string): AdminJwtPayload {
  return jwt.verify(token, getAdminJwtSecret(), { algorithms: ['HS256'] }) as AdminJwtPayload;
}
