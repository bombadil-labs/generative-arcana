import assert from "node:assert/strict";
import { mock } from "node:test";
import nodemailer from "nodemailer";
import { createAuthEmailSender, createAuthSmtpConfigurationFromEnv } from "../src/authEmail.js";
import { createBetterAuthConfigurationFromEnv } from "../src/betterAuth.js";

// Synthetic fixtures only. No environment credentials, DNS, SMTP or provider calls.
const resend = { RESEND_API_KEY: "re_test_only_not_a_real_key", RESEND_EMAIL_DOMAIN: "bombadil.pub" };
const expected = {
  host: "smtp.resend.com", port: 465, secure: true, user: "resend", password: resend.RESEND_API_KEY,
  from: "Generative Arcana <noreply@bombadil.pub>",
};
assert.deepEqual(createAuthSmtpConfigurationFromEnv(resend), expected);
assert.equal(createAuthSmtpConfigurationFromEnv({ ...resend, RESEND_EMAIL_DOMAIN: "Mail.Bombadil.PUB" }).from, "Generative Arcana <noreply@mail.bombadil.pub>");
assert.equal(createAuthSmtpConfigurationFromEnv({ ...resend, RESEND_EMAIL_DOMAIN: "xn--bcher-kva.example" }).from, "Generative Arcana <noreply@xn--bcher-kva.example>");
assert.deepEqual(createBetterAuthConfigurationFromEnv({
  BETTER_AUTH_URL: "https://arcana.example", BETTER_AUTH_SECRET: "test-only-secret-".repeat(3),
  DATABASE_URL: "postgresql://localhost/test-only", ...resend,
}).smtp, expected);

// Both values are mandatory; malformed inputs cannot become email/header syntax.
assert.throws(() => createAuthSmtpConfigurationFromEnv({}), /SMTP_HOST/);
assert.throws(() => createAuthSmtpConfigurationFromEnv({ RESEND_API_KEY: resend.RESEND_API_KEY }), /RESEND_EMAIL_DOMAIN/);
assert.throws(() => createAuthSmtpConfigurationFromEnv({ RESEND_EMAIL_DOMAIN: "bombadil.pub" }), /RESEND_API_KEY/);
for (const domain of [
  "", " ", " bombadil.pub", "bombadil.pub ", "https://bombadil.pub", "noreply@bombadil.pub", "bombadil.pub/path",
  "bombadil.pub:465", "bombadil.pub?x=y", "bombadil.pub#fragment", "*.bombadil.pub", ".bombadil.pub", "bombadil.pub.",
  "bombadil..pub", "-bombadil.pub", "bombadil-.pub", "bombadil._pub", "localhost", "127.0.0.1", "[::1]",
  "bombadil.pub\n", "bombadil.pub\r\nBcc: victim@example.com", "bombadil.pub\0", "bombadil.pub,other.example", "bömbadil.pub",
  `${"a".repeat(64)}.pub`, `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.pub`,
]) assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, RESEND_EMAIL_DOMAIN: domain }), /RESEND_EMAIL_DOMAIN/);
for (const key of ["", " ", "not-a-resend-key", "re_", " re_example", "re_example ", "re_example\n", "re_example\r\n", "re_example\0"]) {
  assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, RESEND_API_KEY: key }), /RESEND_API_KEY/);
}
assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, RESEND_EMAIL_DOMAIN: "invalid/domain" }), (error: unknown) =>
  error instanceof Error && !error.message.includes(resend.RESEND_API_KEY) && !error.message.includes("invalid/domain"));

// Presence, even blank, selects explicit SMTP. Never combine keys from different providers.
const smtp = { SMTP_HOST: "smtp.example", SMTP_FROM: "Arcana <accounts@example.com>" };
const explicit = { host: smtp.SMTP_HOST, from: smtp.SMTP_FROM, port: 587, secure: false, user: undefined, password: undefined };
assert.deepEqual(createAuthSmtpConfigurationFromEnv(smtp), explicit);
assert.deepEqual(createAuthSmtpConfigurationFromEnv({ ...resend, ...smtp }), explicit);
assert.deepEqual(createAuthSmtpConfigurationFromEnv({ RESEND_API_KEY: "malformed", RESEND_EMAIL_DOMAIN: "bad/domain", ...smtp }), explicit);
assert.deepEqual(createAuthSmtpConfigurationFromEnv({ ...resend, ...smtp, SMTP_USER: "smtp-user", SMTP_PASSWORD: "smtp-password", SMTP_PORT: "465", SMTP_SECURE: "true" }),
  { ...explicit, user: "smtp-user", password: "smtp-password", port: 465, secure: true });
for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD"]) {
  assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, [name]: "" }), /SMTP_/);
}
assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, SMTP_HOST: "smtp.example" }), /SMTP_FROM/);
assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, SMTP_FROM: smtp.SMTP_FROM }), /SMTP_HOST/);
assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, ...smtp, SMTP_USER: "user-only" }), /together/);
assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, ...smtp, SMTP_PASSWORD: "password-only" }), /together/);
assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, ...smtp, SMTP_FROM: "Arcana\r\nBcc: victim@example.com" }), /invalid/);
for (const port of ["", "0", "-1", "65536", "1.5", "not-a-port"]) {
  assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, ...smtp, SMTP_PORT: port }), /SMTP_PORT/);
}
for (const secure of ["", "TRUE", "1", "sometimes"]) {
  assert.throws(() => createAuthSmtpConfigurationFromEnv({ ...resend, ...smtp, SMTP_SECURE: secure }), /SMTP_SECURE/);
}

// Stub the transport before creating senders: verify TLS/credentials and truthful delivery outcomes.
let options: unknown;
let submitted: unknown;
let result = { accepted: ["recipient@example.com"], rejected: [] as string[] };
let failure: Error | undefined;
const transportMock = mock.method(nodemailer, "createTransport", (input: unknown) => {
  options = input;
  return { sendMail: async (message: unknown) => { submitted = message; if (failure) throw failure; return result; } };
});
try {
  const send = createAuthEmailSender(createAuthSmtpConfigurationFromEnv(resend));
  assert.deepEqual(options, {
    host: "smtp.resend.com", port: 465, secure: true, requireTLS: false,
    auth: { user: "resend", pass: resend.RESEND_API_KEY },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
  const message = { to: "recipient@example.com", subject: "Test verification", text: "Test-only content" };
  await send(message);
  assert.deepEqual(submitted, { from: expected.from, ...message });
  await assert.rejects(send({ ...message, to: "recipient@example.com\r\nBcc: victim@example.com" }), /Invalid email recipient/);
  result = { accepted: [], rejected: [] };
  await assert.rejects(send(message), /not accepted/);
  result = { accepted: [message.to], rejected: ["other@example.com"] };
  await assert.rejects(send(message), /not accepted/);
  failure = new Error("test-only transport failure");
  await assert.rejects(send(message), /test-only transport failure/);
  createAuthEmailSender(createAuthSmtpConfigurationFromEnv(smtp));
  assert.equal((options as { requireTLS: boolean }).requireTLS, true);
  assert.equal((options as { secure: boolean }).secure, false);
  assert.equal((options as { auth: unknown }).auth, undefined);
} finally { transportMock.mock.restore(); }
console.log("Auth email configuration passed: Marketplace Resend, explicit SMTP precedence, fail-closed validation, TLS and stubbed delivery.");
