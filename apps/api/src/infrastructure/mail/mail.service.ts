import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: string; contentType: string }[];
}

/**
 * Email transaccional. Con SMTP_URL configurado envía por SMTP (Mailpit en desarrollo, SES/Resend
 * en producción). Sin SMTP_URL, fuera de producción, registra el mensaje en el log.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;

  async send(mail: Mail): Promise<void> {
    if (!this.transport) {
      if (env.NODE_ENV === 'production') throw new Error('SMTP_URL no está configurado');
      this.logger.log(`[email simulado] Para: ${mail.to} · ${mail.subject}\n${mail.text}${mail.attachments?.length ? `\n[adjuntos: ${mail.attachments.map((a) => a.filename).join(', ')}]` : ''}`);
      return;
    }
    await this.transport.sendMail({ from: env.MAIL_FROM, ...mail });
  }
}
