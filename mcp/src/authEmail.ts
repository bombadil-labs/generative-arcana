import nodemailer from "nodemailer";

export interface AuthEmail {
  to: string;
  subject: string;
  text: string;
}
export type AuthEmailSender = (message: AuthEmail) => Promise<void>;
export interface AuthSmtpConfiguration {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  password?: string;
}

const smtpEnvironmentKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD"] as const;

/** Server-only configuration. Never mix explicit SMTP credentials with a provider fallback. */
export function createAuthSmtpConfigurationFromEnv(env: NodeJS.ProcessEnv = process.env): AuthSmtpConfiguration {
  const explicitSmtp = smtpEnvironmentKeys.some((key) => env[key] !== undefined);
  if (!explicitSmtp && (env.RESEND_API_KEY !== undefined || env.RESEND_EMAIL_DOMAIN !== undefined)) {
    // Validate syntax locally, not credentials/domain ownership with a live provider call.
    // Domain verification in Resend is an operator prerequisite, not implied by this parser.
    const password = env.RESEND_API_KEY;
    if (!password || !/^re_[A-Za-z0-9_-]+$/.test(password) || /\s/.test(password)) throw new Error("RESEND_API_KEY must be a non-empty Resend API key without whitespace.");
    const domain = env.RESEND_EMAIL_DOMAIN;
    const labels = domain?.split(".") ?? [];
    if (!domain || domain.length > 253 || /[^A-Za-z0-9.-]/.test(domain) || labels.length < 2 ||
      !labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)) ||
      !/^[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]$/.test(labels[labels.length - 1]!)) {
      throw new Error("RESEND_EMAIL_DOMAIN must be a plain DNS domain verified in Resend, without a URL, email address, port, or whitespace.");
    }
    return { host: "smtp.resend.com", port: 465, secure: true, user: "resend", password, from: `Generative Arcana <noreply@${domain.toLowerCase()}>` };
  }

  const required = (value: string | undefined, name: string) => {
    if (!value?.trim()) throw new Error(`${name} is required for explicit SMTP configuration.`);
    return value.trim();
  };
  if (env.SMTP_SECURE !== undefined && env.SMTP_SECURE !== "true" && env.SMTP_SECURE !== "false") throw new Error("SMTP_SECURE must be true or false.");
  const config = {
    host: required(env.SMTP_HOST, "SMTP_HOST"), port: env.SMTP_PORT === undefined ? 587 : Number(env.SMTP_PORT),
    secure: env.SMTP_SECURE === "true", from: required(env.SMTP_FROM, "SMTP_FROM"),
    user: env.SMTP_USER, password: env.SMTP_PASSWORD,
  };
  validateAuthSmtpConfiguration(config);
  return config;
}

function validateAuthSmtpConfiguration(config: AuthSmtpConfiguration): void {
  if (!config.host?.trim() || !config.from?.trim()) throw new Error("SMTP_HOST and SMTP_FROM are required for email authentication.");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("SMTP_PORT must be a valid port.");
  if (Boolean(config.user) !== Boolean(config.password)) throw new Error("SMTP_USER and SMTP_PASSWORD must be supplied together.");
  if (/[\r\n]/.test(config.from)) throw new Error("SMTP_FROM contains invalid characters.");
}

/** No logging transport or pretend success: missing SMTP prevents auth startup. */
export function createAuthEmailSender(config: AuthSmtpConfiguration): AuthEmailSender {
  validateAuthSmtpConfiguration(config);
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // STARTTLS is mandatory when implicit TLS is not selected.
    requireTLS: !config.secure,
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
  return async (message) => {
    if (/[\r\n]/.test(message.to)) throw new Error("Invalid email recipient.");
    const result = await transport.sendMail({ from: config.from, ...message });
    if (!result.accepted?.length || result.rejected?.length) throw new Error("Authentication email was not accepted by the SMTP server.");
  };
}
