// Rebuilds the proposal from the customer's selections and emails it via Resend,
// to the customer with a copy to AP Studios.
import { buildProposal } from '../lib/core.js';
import { tooMany } from '../lib/limit.js';
import { proposalPdf } from '../lib/pdf.js';

const EMAIL_RE = /^[^\s@<>(),;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}$/;

export function cleanName(n) {
  const v = String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return v.length >= 2 && v.length <= 80 && /\p{L}/u.test(v) ? v : '';
}

export function validPhone(p) {
  const digits = String(p).replace(/\D/g, '');
  return /^[+\d][\d ()-]*$/.test(String(p).trim()) && digits.length >= 7 && digits.length <= 15;
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (tooMany(req, 'send', 5, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });

  const { state, name, email, phone, website, requestId } = req.body || {};
  // Hidden field that people never fill in; bots often do. Pretend success.
  if (website) return res.status(200).json({ ok: true });

  const who = cleanName(name);
  const to = String(email || '').trim();
  if (!who) return res.status(400).json({ error: 'Please enter your name.' });
  const tel = String(phone || '').trim();
  if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!validPhone(tel)) return res.status(400).json({ error: 'Please enter a valid phone number.' });

  const { RESEND_API_KEY, PROPOSAL_FROM, PROPOSAL_CC } = process.env;
  if (!RESEND_API_KEY || !PROPOSAL_FROM || !PROPOSAL_CC) {
    console.error('send-proposal: RESEND_API_KEY, PROPOSAL_FROM and PROPOSAL_CC must be set');
    return res.status(500).json({ error: 'Email is not set up yet.' });
  }

  let proposal;
  try {
    proposal = buildProposal(state);
  } catch (err) {
    console.error('send-proposal: could not build proposal', err);
    return res.status(400).json({ error: 'We could not read your selections. Please refresh and try again.' });
  }
  if (!proposal.complete) return res.status(400).json({ error: 'Add at least one renovation work in every selected room before requesting a proposal.' });

  const money = 'S$' + Math.round(proposal.total).toLocaleString('en-SG');
  const text = [
    `Dear ${who},`,
    '',
    'Thank you for using the AP Studios renovation estimator. Your preliminary renovation proposal is attached as a PDF.',
    '',
    `Name: ${who}`,
    `Email: ${to}`,
    `Phone: ${tel}`,
    `Total indicative estimate: ${money} (before GST if applicable; not a quotation)`,
    '',
    'Your AP Studios consultant will contact you to arrange the site survey and in-house consultation.',
    '',
    'AP Studios',
  ].join('\n');

  let pdf;
  try {
    pdf = await proposalPdf({ text: proposal.text, name: who, email: to, phone: tel, total: proposal.total });
  } catch (err) {
    console.error('send-proposal: PDF failed', err);
    return res.status(500).json({ error: 'We could not prepare your proposal.' });
  }
  const fileName = `AP-Studios-proposal-${who.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer'}.pdf`;

  const cc = PROPOSAL_CC.split(',').map((s) => s.trim()).filter(Boolean);

  const headers = { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' };
  if (typeof requestId === 'string' && /^[\w.-]{8,64}$/.test(requestId)) headers['Idempotency-Key'] = requestId;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: PROPOSAL_FROM,
        to: [to],
        cc,
        reply_to: cc[0],
        subject: `Your AP Studios renovation proposal, ${who}`,
        text,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${escHtml(text)}</div>`,
        attachments: [{ filename: fileName, content: pdf.toString('base64') }],
      }),
    });
    if (!r.ok) {
      console.error('send-proposal: Resend error', r.status, await r.text().catch(() => ''));
      return res.status(502).json({ error: 'We could not send your proposal.' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-proposal: network error', err);
    return res.status(502).json({ error: 'We could not send your proposal.' });
  }
}
