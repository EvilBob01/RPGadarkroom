/**
 * Email service
 *
 * In development (MAIL_DRIVER=console) all emails are printed to stdout.
 * In production set MAIL_DRIVER=smtp and fill in SMTP credentials in .env
 *
 * Nodemailer is used for SMTP.  It is an optional dependency — if it isn't
 * installed and MAIL_DRIVER=smtp, the server will fail loudly on startup.
 */
import { MAIL, APP_URL, IS_DEV } from '../config.js';

// ─── Lazy-load nodemailer only if SMTP is configured ─────────────────────────
let _transporter = null;

async function getTransporter() {
  if (_transporter) return _transporter;

  if (MAIL.driver === 'console') {
    return null;   // use console driver
  }

  const { default: nodemailer } = await import('nodemailer');
  _transporter = nodemailer.createTransport({
    host:   MAIL.host,
    port:   MAIL.port,
    secure: MAIL.port === 465,
    auth: {
      user: MAIL.user,
      pass: MAIL.password,
    },
  });

  return _transporter;
}

// ─── Core send function ───────────────────────────────────────────────────────
async function send({ to, subject, text, html }) {
  const transporter = await getTransporter();

  if (!transporter) {
    // Console driver — just log to stdout
    console.log('\n━━━ [EMAIL] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log('');
    console.log(text);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return;
  }

  await transporter.sendMail({
    from:    MAIL.from,
    to,
    subject,
    text,
    html: html ?? text,
  });
}

// ─── Template helpers ─────────────────────────────────────────────────────────
export async function sendVerificationEmail(user, token) {
  const url = `${APP_URL}/verify-email?token=${token}`;

  await send({
    to:      user.email,
    subject: 'Verify your Campaign Dark Room account',
    text: `
Welcome to Campaign Dark Room, ${user.username}!

Please verify your email address by visiting the link below:

  ${url}

This link expires in 24 hours.

If you did not create an account, you can safely ignore this email.
`.trim(),
    html: `
<p>Welcome to <strong>Campaign Dark Room</strong>, ${user.username}!</p>
<p>Please verify your email address:</p>
<p><a href="${url}">${url}</a></p>
<p>This link expires in 24 hours.</p>
<p style="color:#999;font-size:12px;">If you did not create an account, ignore this email.</p>
`.trim(),
  });
}

export async function sendPasswordResetEmail(user, token) {
  const url = `${APP_URL}/reset-password?token=${token}`;

  await send({
    to:      user.email,
    subject: 'Reset your Campaign Dark Room password',
    text: `
Hi ${user.username},

A password reset was requested for your account.
Click the link below to set a new password:

  ${url}

This link expires in 1 hour.

If you did not request a reset, you can safely ignore this email.
`.trim(),
    html: `
<p>Hi <strong>${user.username}</strong>,</p>
<p>A password reset was requested for your Campaign Dark Room account.</p>
<p><a href="${url}">Reset your password</a></p>
<p>This link expires in 1 hour.</p>
<p style="color:#999;font-size:12px;">If you did not request a reset, ignore this email.</p>
`.trim(),
  });
}

export async function sendCampaignInviteEmail({ toEmail, fromUsername, campaignName, inviteCode }) {
  const url = `${APP_URL}/join?code=${inviteCode}`;

  await send({
    to:      toEmail,
    subject: `You've been invited to join "${campaignName}"`,
    text: `
${fromUsername} has invited you to join the campaign "${campaignName}" on Campaign Dark Room.

Your campaign code is: ${inviteCode}

Join directly: ${url}

Or enter the code manually when you log in.
`.trim(),
    html: `
<p><strong>${fromUsername}</strong> has invited you to join the campaign <strong>"${campaignName}"</strong>.</p>
<p>Your campaign code is: <code style="font-size:1.4em;letter-spacing:2px;">${inviteCode}</code></p>
<p><a href="${url}">Click here to join directly</a></p>
<p style="color:#999;font-size:12px;">Or enter the code manually after logging in.</p>
`.trim(),
  });
}
