import 'server-only';

import fs from 'fs/promises';
import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

type AuthOk = { ok: true; auth: InstanceType<typeof google.auth.GoogleAuth> };
type AuthFail = { ok: false; reason: 'auth'; message: string };

/**
 * Reads and parses the service-account key file.
 * Returns the parsed object on success, or null on any failure.
 * Never throws; never logs the private_key.
 */
async function readKeyFile(): Promise<Record<string, unknown> | null> {
  const keyFile = process.env.GOOGLE_SA_KEY_FILE;
  if (!keyFile) return null;

  let raw: string;
  try {
    raw = await fs.readFile(keyFile, 'utf-8');
  } catch {
    return null;
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Builds a GoogleAuth service-account client.
 *
 * Returns {ok:true, auth} when the key file is valid and contains both
 * `private_key` and `client_email`. Returns {ok:false, reason:'auth'} when:
 *   - GOOGLE_SA_KEY_FILE env var is unset
 *   - the file is missing or unreadable
 *   - the file is not valid JSON
 *   - the JSON lacks `private_key` or `client_email`
 *
 * Never throws; never logs the private_key.
 */
export async function getAuthClient(): Promise<AuthOk | AuthFail> {
  const keyFile = process.env.GOOGLE_SA_KEY_FILE;
  if (!keyFile) {
    return { ok: false, reason: 'auth', message: 'GOOGLE_SA_KEY_FILE env var is not set' };
  }

  const parsed = await readKeyFile();
  if (parsed === null) {
    return { ok: false, reason: 'auth', message: 'Could not read or parse the service-account key file' };
  }

  if (!parsed.private_key || !parsed.client_email) {
    return {
      ok: false,
      reason: 'auth',
      message: 'Service-account key file is missing required fields (private_key / client_email)',
    };
  }

  const auth = new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
  return { ok: true, auth };
}

/**
 * Returns the `client_email` from the service-account key file.
 * Returns null if the env var is unset, the file is missing/unparseable,
 * or the parsed JSON has no `client_email`.
 * Never logs or returns the private_key.
 */
export async function getServiceAccountEmail(): Promise<string | null> {
  const parsed = await readKeyFile();
  if (parsed === null) return null;

  const email = parsed.client_email;
  if (typeof email !== 'string' || email.length === 0) return null;

  return email;
}
