// Runs the estimator's own pricing and proposal code (estimator.js) on the server,
// so the emailed proposal is rebuilt from the customer's selections and cannot be
// edited in the browser. estimator.js stays the single source of truth for prices.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

process.env.TZ = process.env.TZ || 'Asia/Singapore';

let cached;

function loadCore() {
  if (cached) return cached;
  const src = fs.readFileSync(path.join(process.cwd(), 'estimator.js'), 'utf8');
  const el = () => ({ style: {}, textContent: '', innerHTML: '' });
  const sandbox = {
    document: { getElementById: el },
    localStorage: { getItem: () => null, setItem: () => {} },
    window: { scrollTo: () => {}, location: {} },
    console,
  };
  vm.createContext(sandbox);
  // Appended in the same script so it can see the estimator's top-level bindings.
  const expose = `;globalThis.__core={setState(s){state=s},defaults,proposalText,allRoomsComplete,total,availableRooms,unitTypes,conditions,styles,C,rooms,PLAN_TYPE_LABELS};`;
  vm.runInContext(src + expose, sandbox, { filename: 'estimator.js', timeout: 2000 });
  cached = sandbox.__core;
  return cached;
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const numStr = (v) => (/^\d{1,7}(\.\d{1,2})?$/.test(String(v ?? '').trim()) ? String(v).trim() : '');

// Accept only known values; anything else falls back to the estimator defaults.
export function sanitiseState(input) {
  const core = loadCore();
  const s = core.defaults();
  const i = input && typeof input === 'object' ? input : {};

  s.property = Object.keys(core.unitTypes).includes(i.property) ? i.property : 'HDB';
  s.unit = core.unitTypes[s.property].includes(i.unit) ? i.unit : '';
  const homes = s.property === 'HDB' ? ['BTO', 'Resale', 'Existing home'] : ['Newly completed', 'Resale', 'Existing home'];
  s.home = homes.includes(i.home) ? i.home : homes[0];
  s.finish = ['Not sure', 'Bare floors in some rooms', 'Existing tiles / finishes', 'Mix of finished and bare areas'].includes(i.finish) ? i.finish : 'Not sure';
  s.homeArea = numStr(i.homeArea);
  s.budget = numStr(i.budget);
  s.floorName = str(i.floorName, 120).replace(/[\r\n<>]/g, ' ');
  s.floorData = '';
  s.designService = i.designService !== false;

  core.setState(s); // availableRooms() reads property and unit
  const allowed = core.availableRooms().map((r) => r[0]);
  s.selected = [...new Set(Array.isArray(i.selected) ? i.selected : [])].filter((r) => allowed.includes(r));

  s.items = {};
  const grades = ['Standard', 'Premium'];
  for (const r of s.selected) {
    for (const row of core.C[r]) {
      const x = i.items && i.items[r + '|' + row[0]];
      if (!x || x.on !== true) continue;
      s.items[r + '|' + row[0]] = {
        on: true,
        grade: grades.includes(x.grade) ? x.grade : 'Standard',
        condition: core.conditions.includes(x.condition) ? x.condition : core.conditions[0],
      };
    }
  }

  s.styles = {};
  for (const r of s.selected) {
    const v = i.styles && i.styles[r];
    if (core.styles.includes(v)) s.styles[r] = v;
  }

  const roomIds = core.rooms.map((r) => r[0]);
  s.planRooms = (Array.isArray(i.planRooms) ? i.planRooms : []).slice(0, 30)
    .filter((x) => x && Object.hasOwn(core.PLAN_TYPE_LABELS, x.type))
    .map((x) => ({
      type: x.type,
      id: roomIds.includes(x.id) ? x.id : null,
      area: typeof x.area === 'number' && x.area > 0 && x.area < 5000 ? Math.round(x.area) : null,
    }));
  s.planWarnings = [];
  s.step = 5;
  s.active = s.selected[0] || 'living';
  return s;
}

export function buildProposal(input) {
  const core = loadCore();
  const s = sanitiseState(input);
  core.setState(s);
  return { state: s, complete: core.allRoomsComplete(), total: core.total(), text: core.proposalText() };
}

export function planTypes() {
  return Object.keys(loadCore().PLAN_TYPE_LABELS);
}
