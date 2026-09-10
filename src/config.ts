import { resolve } from 'node:path'

export type DatabaseMode = 'pglite' | 'postgres'

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  host: string
  port: number
  corsOrigins: string[]
  databaseMode: DatabaseMode
  pgliteDataDir: string
  databaseUrl?: string
  jwtAccessSecret: string
  accessTokenTtl: string
  refreshTokenDays: number
  devAuthEnabled: boolean
  devSeedEnabled: boolean
  devAdminEmail?: string
  devAdminPassword?: string
  otpDeliveryWebhookUrl?: string
  otpDeliveryApiKey?: string
  resendApiKey?: string
  brevoApiKey?: string
  brevoSenderEmail?: string
  emailFrom?: string
  bootstrapAdminEmail?: string
  demoDataEnabled?: boolean
  uploadDir: string
  maxUploadBytes: number
}

function bool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function int(value: string | undefined, fallback: number, name: string) {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv']
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV is invalid')

  const databaseMode = (env.DATABASE_MODE ?? 'pglite') as DatabaseMode
  if (!['pglite', 'postgres'].includes(databaseMode)) throw new Error('DATABASE_MODE must be pglite or postgres')

  const jwtAccessSecret = env.JWT_ACCESS_SECRET ?? ''
  if (jwtAccessSecret.length < 32) throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters')

  const devAuthEnabled = bool(env.DEV_AUTH_ENABLED, nodeEnv !== 'production')
  if (nodeEnv === 'production' && devAuthEnabled) throw new Error('DEV_AUTH_ENABLED cannot be enabled in production')
  if (!devAuthEnabled && !env.OTP_DELIVERY_WEBHOOK_URL && !env.RESEND_API_KEY && !env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY, RESEND_API_KEY or OTP_DELIVERY_WEBHOOK_URL is required when development authentication is disabled')
  }
  if (env.BREVO_API_KEY && !emailPattern.test(env.BREVO_SENDER_EMAIL?.trim() ?? '')) {
    throw new Error('BREVO_SENDER_EMAIL must be a valid, verified Brevo sender when BREVO_API_KEY is set')
  }
  if (nodeEnv === 'production' && env.OTP_DELIVERY_WEBHOOK_URL && !env.OTP_DELIVERY_WEBHOOK_URL.startsWith('https://')) {
    throw new Error('OTP_DELIVERY_WEBHOOK_URL must use HTTPS in production')
  }
  const devSeedEnabled = bool(env.DEV_SEED_ENABLED, false)
  if (nodeEnv === 'production' && devSeedEnabled) throw new Error('DEV_SEED_ENABLED cannot be enabled in production')
  if (devSeedEnabled && !emailPattern.test(env.DEV_ADMIN_EMAIL ?? '')) {
    throw new Error('DEV_ADMIN_EMAIL must be a valid email when development seed data is enabled')
  }
  if (devSeedEnabled && !strongPassword(env.DEV_ADMIN_PASSWORD ?? '')) {
    throw new Error('DEV_ADMIN_PASSWORD must be at least 8 characters and include upper, lower, number, and symbol')
  }
  if (databaseMode === 'postgres' && !env.DATABASE_URL) throw new Error('DATABASE_URL is required for postgres mode')

  return {
    nodeEnv,
    host: env.HOST ?? '127.0.0.1',
    port: int(env.PORT, 4000, 'PORT'),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((x) => x.trim()).filter(Boolean),
    databaseMode,
    pgliteDataDir: env.PGLITE_DATA_DIR === 'memory://' ? 'memory://' : resolve(env.PGLITE_DATA_DIR ?? './.data/solvesphere'),
    databaseUrl: env.DATABASE_URL,
    jwtAccessSecret,
    accessTokenTtl: env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTokenDays: int(env.REFRESH_TOKEN_DAYS, 7, 'REFRESH_TOKEN_DAYS'),
    devAuthEnabled,
    devSeedEnabled,
    devAdminEmail: env.DEV_ADMIN_EMAIL?.trim().toLowerCase() || undefined,
    devAdminPassword: env.DEV_ADMIN_PASSWORD,
    otpDeliveryWebhookUrl: env.OTP_DELIVERY_WEBHOOK_URL,
    otpDeliveryApiKey: env.OTP_DELIVERY_API_KEY,
    resendApiKey: env.RESEND_API_KEY,
    brevoApiKey: env.BREVO_API_KEY,
    brevoSenderEmail: env.BREVO_SENDER_EMAIL?.trim().toLowerCase(),
    emailFrom: env.EMAIL_FROM?.trim() || 'SolveSphere <onboarding@resend.dev>',
    bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || undefined,
    demoDataEnabled: bool(env.DEMO_DATA_ENABLED, false),
    uploadDir: resolve(env.UPLOAD_DIR ?? './uploads'),
    maxUploadBytes: int(env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024, 'MAX_UPLOAD_BYTES'),
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function strongPassword(value: string) {
  return value.length >= 8 && Buffer.byteLength(value, 'utf8') <= 72 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value)
}
