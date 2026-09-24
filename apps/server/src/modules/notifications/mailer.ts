import nodemailer from 'nodemailer';
import type { Logger } from 'pino';
import type { Config } from '../../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Notification provider boundary. Swap the implementation without touching the domain. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development/test mailer: logs messages and keeps the latest ones for the dev outbox page. */
export class ConsoleMailer implements Mailer {
  readonly sent: Array<MailMessage & { at: string }> = [];
  constructor(private readonly log?: Logger) {}
  async send(message: MailMessage): Promise<void> {
    this.sent.unshift({ ...message, at: new Date().toISOString() });
    this.sent.length = Math.min(this.sent.length, 100);
    this.log?.info({ to: message.to, subject: message.subject }, 'mail (console transport)');
  }
}

export function createMailer(config: Config, log: Logger): Mailer {
  if (config.MAIL_TRANSPORT === 'console') return new ConsoleMailer(log);
  const transport = nodemailer.createTransport(config.SMTP_URL!);
  return {
    async send(m) {
      await transport.sendMail({ from: config.MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  };
}
