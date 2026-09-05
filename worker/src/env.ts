export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  JWT_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  R2_PUBLIC_BASE: string;
  SITE_BASE: string;
  ALLOWED_ORIGINS: string;
}

export interface SessionUser {
  id: number;
  username: string;
  role: 'owner' | 'editor';
  displayName: string;
}

export type Vars = { user: SessionUser };
