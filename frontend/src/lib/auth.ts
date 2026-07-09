import { createAuthClient } from '@neondatabase/neon-js/auth';
const url = process.env.BUN_PUBLIC_NEON_AUTH_URL!;
export const authClient = createAuthClient(url);
