import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

// Mock googleapis before importing auth
vi.mock('googleapis', () => {
  const GoogleAuthMock = vi.fn().mockImplementation((opts: unknown) => ({
    _opts: opts,
  }));
  return {
    google: {
      auth: {
        GoogleAuth: GoogleAuthMock,
      },
    },
  };
});

import { google } from 'googleapis';
import { getAuthClient, getServiceAccountEmail } from './auth';

const FIXTURE_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAA...\n-----END RSA PRIVATE KEY-----';
const FIXTURE_CLIENT_EMAIL = 'test-sa@my-project.iam.gserviceaccount.com';

const validKeyJson = JSON.stringify({
  type: 'service_account',
  project_id: 'my-project',
  private_key_id: 'abc123',
  private_key: FIXTURE_PRIVATE_KEY,
  client_email: FIXTURE_CLIENT_EMAIL,
  client_id: '123456789',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
});

let tmpDir: string;
let keyFilePath: string;
let savedEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-test-'));
  keyFilePath = path.join(tmpDir, 'service-account.json');
  savedEnv = process.env.GOOGLE_SA_KEY_FILE;
  vi.clearAllMocks();
});

afterEach(async () => {
  process.env.GOOGLE_SA_KEY_FILE = savedEnv;
  if (savedEnv === undefined) {
    delete process.env.GOOGLE_SA_KEY_FILE;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('getAuthClient', () => {
  it('returns {ok:true} and passes both scopes to GoogleAuth when key file exists', async () => {
    await fs.writeFile(keyFilePath, validKeyJson);
    process.env.GOOGLE_SA_KEY_FILE = keyFilePath;

    const result = await getAuthClient();

    expect(result.ok).toBe(true);
    const GoogleAuth = google.auth.GoogleAuth as unknown as ReturnType<typeof vi.fn>;
    expect(GoogleAuth).toHaveBeenCalledOnce();
    const callArgs = GoogleAuth.mock.calls[0][0] as { keyFile: string; scopes: string[] };
    expect(callArgs.keyFile).toBe(keyFilePath);
    expect(callArgs.scopes).toContain('https://www.googleapis.com/auth/analytics.readonly');
    expect(callArgs.scopes).toContain('https://www.googleapis.com/auth/webmasters.readonly');
  });

  it('returns {ok:false, reason:"auth"} when GOOGLE_SA_KEY_FILE env var is unset', async () => {
    delete process.env.GOOGLE_SA_KEY_FILE;

    const result = await getAuthClient();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('auth');
      expect(typeof result.message).toBe('string');
    }
  });

  it('returns {ok:false, reason:"auth"} when key file path does not exist', async () => {
    process.env.GOOGLE_SA_KEY_FILE = path.join(tmpDir, 'nonexistent.json');

    const result = await getAuthClient();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('auth');
    }
  });

  it('returns {ok:false, reason:"auth"} when file contains malformed JSON', async () => {
    await fs.writeFile(keyFilePath, 'this is not valid JSON {{{');
    process.env.GOOGLE_SA_KEY_FILE = keyFilePath;

    const result = await getAuthClient();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('auth');
    }
  });

  it('returns {ok:false, reason:"auth"} when JSON lacks private_key', async () => {
    const noPrivateKey = JSON.stringify({ type: 'service_account', client_email: FIXTURE_CLIENT_EMAIL });
    await fs.writeFile(keyFilePath, noPrivateKey);
    process.env.GOOGLE_SA_KEY_FILE = keyFilePath;

    const result = await getAuthClient();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('auth');
    }
  });

  it('returns {ok:false, reason:"auth"} when JSON lacks client_email', async () => {
    const noClientEmail = JSON.stringify({ type: 'service_account', private_key: FIXTURE_PRIVATE_KEY });
    await fs.writeFile(keyFilePath, noClientEmail);
    process.env.GOOGLE_SA_KEY_FILE = keyFilePath;

    const result = await getAuthClient();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('auth');
    }
  });

  it('does not expose private_key in the returned message on failure', async () => {
    // Write a key file with private_key present but client_email missing.
    // This exercises the path where the key is actually parsed before the guard fails.
    const keyWithoutEmail = JSON.stringify({
      type: 'service_account',
      project_id: 'my-project',
      private_key_id: 'abc123',
      private_key: FIXTURE_PRIVATE_KEY,
      client_id: '123456789',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      // Note: client_email is intentionally omitted
    });
    await fs.writeFile(keyFilePath, keyWithoutEmail);
    process.env.GOOGLE_SA_KEY_FILE = keyFilePath;

    const result = await getAuthClient();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('auth');
      // The key was parsed into memory but should not leak into the message
      expect(result.message).not.toContain(FIXTURE_PRIVATE_KEY);
    }
  });
});

describe('getServiceAccountEmail', () => {
  it('returns client_email from valid key file', async () => {
    await fs.writeFile(keyFilePath, validKeyJson);
    process.env.GOOGLE_SA_KEY_FILE = keyFilePath;

    const email = await getServiceAccountEmail();
    expect(email).toBe(FIXTURE_CLIENT_EMAIL);
  });

  it('returns null when GOOGLE_SA_KEY_FILE is unset', async () => {
    delete process.env.GOOGLE_SA_KEY_FILE;

    const email = await getServiceAccountEmail();
    expect(email).toBeNull();
  });

  it('returns null when file does not exist', async () => {
    process.env.GOOGLE_SA_KEY_FILE = path.join(tmpDir, 'nonexistent.json');

    const email = await getServiceAccountEmail();
    expect(email).toBeNull();
  });

  it('returns null when JSON is malformed', async () => {
    await fs.writeFile(keyFilePath, 'not json');
    process.env.GOOGLE_SA_KEY_FILE = keyFilePath;

    const email = await getServiceAccountEmail();
    expect(email).toBeNull();
  });

  it('returns null when JSON parses but has no client_email', async () => {
    await fs.writeFile(keyFilePath, JSON.stringify({ type: 'service_account', private_key: FIXTURE_PRIVATE_KEY }));
    process.env.GOOGLE_SA_KEY_FILE = keyFilePath;

    const email = await getServiceAccountEmail();
    expect(email).toBeNull();
  });

  it('does not return the private_key value', async () => {
    await fs.writeFile(keyFilePath, validKeyJson);
    process.env.GOOGLE_SA_KEY_FILE = keyFilePath;

    const email = await getServiceAccountEmail();
    expect(email).not.toBe(FIXTURE_PRIVATE_KEY);
    expect(email).not.toContain('PRIVATE KEY');
  });

  it('returns null and never exposes private_key when client_email is missing', async () => {
    // Verify that even when private_key is present in the file,
    // getServiceAccountEmail() safely returns null without exposing the key.
    const keyWithoutEmail = JSON.stringify({
      type: 'service_account',
      project_id: 'my-project',
      private_key_id: 'abc123',
      private_key: FIXTURE_PRIVATE_KEY,
      client_id: '123456789',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      // Note: client_email is intentionally omitted
    });
    await fs.writeFile(keyFilePath, keyWithoutEmail);
    process.env.GOOGLE_SA_KEY_FILE = keyFilePath;

    const email = await getServiceAccountEmail();
    expect(email).toBeNull();
    expect(email).not.toBe(FIXTURE_PRIVATE_KEY);
  });
});
