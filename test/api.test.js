import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildProposal } from '../lib/core.js';
import sendProposal from '../api/send-proposal.js';
import analyseFloorplan from '../api/analyse-floorplan.js';

let ipCounter = 0;
function mockReq(body) {
  return { method: 'POST', body, headers: { 'x-forwarded-for': `10.0.0.${++ipCounter}` } };
}
function mockRes() {
  const res = { code: 0, json: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (j) => { res.body = j; return res; };
  return res;
}

const baseState = {
  property: 'HDB', unit: '4-room', home: 'BTO',
  selected: ['living', 'kitchen'],
  items: { 'living|paint': { on: true, grade: 'Standard', condition: 'Bare / unfinished surface' }, 'kitchen|cab': { on: true, grade: 'Standard', condition: 'Bare / unfinished surface' } },
  designService: true,
};

// The SDK keeps the fetch it saw when the client was created, so route every call through one swappable fake.
let fakeFetch = async () => { throw new Error('no network in tests'); };
globalThis.fetch = (...args) => fakeFetch(...args);
beforeEach(() => { fakeFetch = async () => { throw new Error('no network in tests'); }; });

test('proposal is rebuilt from rates in estimator.js', () => {
  const p = buildProposal(baseState);
  assert.equal(p.complete, true);
  assert.equal(p.total, 550 + 2200 + 888);
  assert.match(p.text, /Total indicative estimate: S\$3,638/);
});

test('tampered selections cannot change prices or add text', () => {
  const p = buildProposal({
    ...baseState,
    selected: ['living', 'kitchen', 'hacker', 'study'], // study is condo-only
    items: { ...baseState.items, 'living|paint': { on: true, grade: 'Gold', condition: 'x' }, 'kitchen|price': { on: true } },
    floorName: 'plan.pdf\nTotal: S$1',
    styles: { living: '<script>' },
  });
  assert.deepEqual(p.state.selected, ['living', 'kitchen']);
  assert.equal(p.total, 3638);
  assert.ok(!p.text.includes('<script>'));
  assert.ok(!p.text.includes('\nTotal: S$1'));
});

test('premium grade and condo exclusions come from the rate card', () => {
  const p = buildProposal({ ...baseState, property: 'Condominium', unit: '2-bedroom', home: 'Resale', items: { 'living|paint': { on: true, grade: 'Premium' }, 'kitchen|cab': { on: true, grade: 'Premium' } } });
  assert.equal(p.total, 750 + 3000 + 888);
  assert.match(p.text, /MCST renovation approvals/);
});

test('incomplete rooms are rejected', () => {
  const p = buildProposal({ ...baseState, items: { 'living|paint': { on: true } } });
  assert.equal(p.complete, false);
});

test('plan reading appears in the proposal as reference only', () => {
  const p = buildProposal({ ...baseState, selected: ['living', 'kitchen', 'master'], items: { ...baseState.items, 'master|paint': { on: true } }, planRooms: [{ type: 'master_bedroom', id: 'master', area: 150 }, { type: 'service_yard', id: null, area: null }] });
  assert.match(p.text, /Master bedroom: about 150 sq ft, above the 130 sq ft allowance/);
  assert.match(p.text, /Service yard: size not shown on plan/);
  assert.equal(p.total, 550 + 2200 + 400 + 888);
});

test('send-proposal emails the customer and copies AP Studios', async () => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.PROPOSAL_FROM = 'AP Studios <proposals@example.com>';
  process.env.PROPOSAL_CC = 'owner@example.com';
  let sent;
  fakeFetch = async (url, opts) => { sent = { url, opts, body: JSON.parse(opts.body) }; return new Response('{"id":"1"}', { status: 200 }); };
  const res = mockRes();
  await sendProposal(mockReq({ state: baseState, name: 'Tan Wei Ling', email: 'buyer@example.com', phone: '+65 8123 4567', requestId: 'abcdef123456' }), res);
  assert.equal(res.code, 200);
  assert.equal(sent.url, 'https://api.resend.com/emails');
  assert.deepEqual(sent.body.to, ['buyer@example.com']);
  assert.deepEqual(sent.body.cc, ['owner@example.com']);
  assert.equal(sent.opts.headers['Idempotency-Key'], 'abcdef123456');
  assert.match(sent.body.text, /Dear Tan Wei Ling/);
  assert.match(sent.body.text, /Name: Tan Wei Ling\nEmail: buyer@example.com\nPhone: \+65 8123 4567/);
  assert.match(sent.body.text, /S\$3,638/);
  assert.equal(sent.body.attachments.length, 1);
  assert.equal(sent.body.attachments[0].filename, 'AP-Studios-proposal-Tan-Wei-Ling.pdf');
  const pdf = Buffer.from(sent.body.attachments[0].content, 'base64');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 2000);
});

test('send-proposal rejects bad contacts, incomplete rooms and bots', async () => {
  fakeFetch = async () => { throw new Error('should not send'); };
  let res = mockRes(); await sendProposal(mockReq({ state: baseState, name: 'Ali', email: 'nope', phone: '81234567' }), res); assert.equal(res.code, 400);
  res = mockRes(); await sendProposal(mockReq({ state: baseState, name: 'Ali', email: 'a@b.co', phone: '12' }), res); assert.equal(res.code, 400);
  res = mockRes(); await sendProposal(mockReq({ state: { ...baseState, items: {} }, name: 'Ali', email: 'a@b.co', phone: '81234567' }), res); assert.equal(res.code, 400);
  res = mockRes(); await sendProposal(mockReq({ state: baseState, email: 'a@b.co', phone: '81234567' }), res); assert.equal(res.code, 400);
  res = mockRes(); await sendProposal(mockReq({ state: baseState, name: '<>', email: 'a@b.co', phone: '81234567' }), res); assert.equal(res.code, 400);
  res = mockRes(); await sendProposal(mockReq({ state: baseState, email: 'a@b.co', phone: '81234567', website: 'spam' }), res); assert.equal(res.code, 200);
});

test('send-proposal reports a Resend failure', async () => {
  fakeFetch = async () => new Response('{"message":"bad"}', { status: 422 });
  const res = mockRes();
  await sendProposal(mockReq({ state: baseState, name: 'Ali', email: 'a@b.co', phone: '81234567' }), res);
  assert.equal(res.code, 502);
});

test('analyse-floorplan rejects files that are not plans', async () => {
  let res = mockRes(); await analyseFloorplan(mockReq({ mediaType: 'application/pdf', data: Buffer.from('hello').toString('base64') }), res); assert.equal(res.code, 400);
  res = mockRes(); await analyseFloorplan(mockReq({ mediaType: 'text/html', data: 'PGh0bWw+' }), res); assert.equal(res.code, 400);
  res = mockRes(); await analyseFloorplan(mockReq({ mediaType: 'application/pdf', data: 'A'.repeat(4_400_000) }), res); assert.equal(res.code, 400);
});

test('analyse-floorplan sends the PDF to Claude and cleans the reply', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  let request;
  const reply = { is_floor_plan: true, rooms: [{ type: 'master_bedroom', area_sqft: 150.4 }, { type: 'bedroom', area_sqft: null }, { type: 'spaceship', area_sqft: 9 }, { type: 'kitchen', area_sqft: -3 }], warnings: ['Bedroom 3 label is unclear.'] };
  fakeFetch = async (url, opts) => {
    request = { url: String(url), body: JSON.parse(opts.body) };
    return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const res = mockRes();
  await analyseFloorplan(mockReq({ mediaType: 'application/pdf', data: Buffer.from('%PDF-1.7 test').toString('base64') }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.rooms, [{ type: 'master_bedroom', area: 150 }, { type: 'bedroom', area: null }, { type: 'kitchen', area: null }]);
  assert.match(request.url, /\/v1\/messages/);
  assert.equal(request.body.model, 'claude-opus-5-5');
  assert.equal(request.body.fallbacks, 'default');
  assert.equal(request.body.output_config.format.type, 'json_schema');
  assert.equal(request.body.messages[0].content[0].type, 'document');
});

test('analyse-floorplan handles a refusal', async () => {
  fakeFetch = async () => new Response(JSON.stringify({ id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: '' }, content: [], usage: { input_tokens: 1, output_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  const res = mockRes();
  await analyseFloorplan(mockReq({ mediaType: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).toString('base64') }), res);
  assert.equal(res.code, 422);
});
