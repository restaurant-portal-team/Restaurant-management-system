/**
 * npm run auth:bootstrap-owner
 *
 * Creates the FIRST Owner account (F03, decision D3). Run by a human in an interactive terminal.
 * - No default or seeded credentials: name, email and password are typed by the human; the password
 *   is read with hidden input, hashed with Argon2id and never printed, logged or stored in plaintext.
 * - Uses the runtime role (DATABASE_URL from backend/.env, read privately with node:util.parseEnv).
 * - Refuses if ANY Owner already exists (checked under a transaction-scoped advisory lock).
 * - Prints only the new account id; never URLs, emails, passwords or hashes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { hashPassword, newPasswordProblem, normalizeEmail } from '../../src/auth/password.ts';
import { BACKEND_ROOT } from '../db/migration-env.ts';
import { describeCode, safeErrorCode } from '../db/safe-error.ts';
import { uuidV7 } from './uuid-v7.ts';

/** Arbitrary constant key for pg_advisory_xact_lock: serialises concurrent bootstrap runs. */
const BOOTSTRAP_LOCK_KEY = 732_004_101;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message: string): never {
  console.error(`[auth:bootstrap-owner] ${message}`);
  process.exit(1);
}

function runtimeUrl(): string {
  const file = resolve(BACKEND_ROOT, '.env');
  if (!existsSync(file)) fail('backend/.env is missing.');
  const value = parseEnv(readFileSync(file, 'utf8')).DATABASE_URL?.trim();
  if (!value) fail('DATABASE_URL is missing in backend/.env.');
  return value;
}

/** Reads a line without echoing it (raw mode). Ctrl+C aborts. */
async function readHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) fail('Run this script in an interactive terminal.');
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolvePromise) => {
    let value = '';
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\u0003') {
          stdout.write('\n');
          process.exit(130);
        } else if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolvePromise(value);
          return;
        } else if (char === '\u0008' || char === '\u007f') {
          value = value.slice(0, -1);
        } else if (char >= ' ') {
          value += char;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const url = runtimeUrl();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const fullName = (await rl.question('Owner full name: ')).trim().replace(/\s+/g, ' ');
  const email = normalizeEmail(await rl.question('Owner email: '));
  rl.close();

  if (fullName.length < 1 || fullName.length > 120) fail('Full name must be 1-120 characters.');
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) fail('Email address is not valid.');

  const password = await readHidden('Password (hidden, min 12 characters): ');
  const problem = newPasswordProblem(password, email);
  if (problem) fail(problem);
  if ((await readHidden('Repeat password: ')) !== password) fail('Passwords did not match. Nothing was created.');

  const passwordHash = await hashPassword(password);
  const id = uuidV7();

  const client = new pg.Client({
    connectionString: url,
    application_name: 'auth-bootstrap-owner',
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK_KEY]);
    const existing = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.users WHERE role = 'OWNER'",
    );
    if (existing.rows[0]?.count !== '0') {
      await client.query('ROLLBACK');
      fail('An Owner account already exists. Nothing was created.');
    }
    await client.query(
      `INSERT INTO public.users
         (id, full_name, email, password_hash, role, is_active, activated_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'OWNER', true, now(), now(), now())`,
      [id, fullName, email, passwordHash],
    );
    await client.query('COMMIT');
    console.log(`[auth:bootstrap-owner] Owner account created (id ${id}). You can now sign in at /login.`);
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    const code = safeErrorCode(error);
    if (code === '23505') fail('An account with this email already exists. Nothing was created.');
    fail(`Failed [${code}] (${describeCode(code)}). Nothing was created.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

await main();
