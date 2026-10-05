// SMTP-Versand (Passwort-Reset, Zahltag) über nodemailer. Konfiguration per Env-Variablen.
import nodemailer from 'nodemailer'

export function createMailer(env = process.env) {
  if (!env.SMTP_HOST) {
    return { configured: false, send: async () => { throw new Error('E-Mail-Versand ist nicht eingerichtet (SMTP_HOST fehlt).') } }
  }
  const port = Number(env.SMTP_PORT ?? 587)
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
  const from = env.SMTP_FROM ?? env.SMTP_USER
  return {
    configured: true,
    send: (msg) => transport.sendMail({ from, ...msg }),
  }
}
