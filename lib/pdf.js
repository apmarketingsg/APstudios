// Turns the proposal text (built by estimator.js) into a branded PDF.
import PDFDocument from 'pdfkit';

const GREEN = '#2f5d50';
const ACCENT = '#c4673f';
const INK = '#1f2a27';
const MUTED = '#5d6965';

// Standard PDF fonts cannot draw every character; swap the few that may appear.
const clean = (s) => String(s).replace(/[✓✔]/g, '').replace(/[^\x20-\x7E -ÿ–—‘’“”•…]/g, '');

export function proposalPdf({ text, name, email, phone, total }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: 'AP Studios preliminary renovation proposal', Author: 'AP Studios' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const width = doc.page.width - 112;

    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('AP ', { continued: true }).fillColor(ACCENT).text('Studios');
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Design and build renovation for BTOs and condos. Headquartered in Singapore.');
    doc.moveDown(1.2);

    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN).text('PREPARED FOR');
    doc.font('Helvetica').fontSize(11).fillColor(INK);
    doc.text(clean(name)).text(clean(email)).text(clean(phone));
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(GREEN).text(`Total indicative estimate: S$${Math.round(total).toLocaleString('en-SG')}`);
    doc.moveDown(0.6);
    doc.moveTo(56, doc.y).lineTo(56 + width, doc.y).strokeColor('#e3ddd3').stroke();
    doc.moveDown(0.8);

    const lines = String(text).split('\n');
    lines.forEach((raw, i) => {
      const line = clean(raw);
      if (i === 0) {
        doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(line);
        doc.moveDown(0.3);
        return;
      }
      if (!line.trim()) { doc.moveDown(0.5); return; }
      if (line.startsWith('  - ')) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('•  ' + line.slice(4), 72, doc.y, { width: width - 16 });
      } else if (line.startsWith('- ')) {
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text('•  ' + line.slice(2), 64, doc.y, { width: width - 8 });
      } else if (/ — S\$[\d,]+$/.test(line) && !line.includes(':')) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(12.5).fillColor(GREEN).text(line, 56, doc.y, { width });
      } else if (/^(Total indicative estimate|Exclusions & separately quoted works|Floor plan reading)/.test(line)) {
        doc.font('Helvetica-Bold').fontSize(11.5).fillColor(INK).text(line, 56, doc.y, { width });
      } else if (/: S\$[\d,]+$/.test(line)) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(line, 56, doc.y, { width });
      } else {
        doc.font('Helvetica').fontSize(10).fillColor(INK).text(line, 56, doc.y, { width });
      }
    });

    doc.moveDown(1);
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text('This is a preliminary, non-binding estimate, not a quotation. Final scope, measurements, feasibility, permits and pricing are confirmed after the site survey.', 56, doc.y, { width });
    doc.end();
  });
}
