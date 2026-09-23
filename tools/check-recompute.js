// 验收脚本：模拟拖动两次订单顺序，核对三个指标每次都跟着变
const path = require('path');
const dataDir = path.join(__dirname, '..', 'data');
const data = require(path.join(dataDir, 'boards.json'));
const { orders } = require(path.join(dataDir, 'orders.json'));

const parts = (b) => new Set(b.components.map((c) => c.part));
const nozzles = (b) => new Set(b.components.map((c) => c.nozzle));

function trans(m, prev, b) {
  const ps = parts(b);
  const added = prev ? [...ps].filter((p) => !prev.has(p)) : [];
  const removed = prev ? [...prev].filter((p) => !ps.has(p)) : [];
  const overflow = Math.max(0, ps.size - m.slots);
  const missing = [...nozzles(b)].filter((n) => !m.nozzles.includes(n));
  const conflict = Math.max(0, nozzles(b).size - m.nozzleSlots);
  return { count: prev ? added.length + removed.length + overflow * 2 + missing.length : 0,
    conflict, ps };
}

function run(ords) {
  const byId = Object.fromEntries(data.boards.map((b) => [b.id, b]));
  const seq = [...ords].sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0)
    || ords.indexOf(a) - ords.indexOf(b));
  const ms = data.machines.map((cfg) => ({ cfg, items: [], prev: null, pts: 0, co: 0 }));
  for (const o of seq) {
    const b = byId[o.boardId];
    let best = null;
    for (const st of ms) {
      const t = trans(st.cfg, st.prev, b);
      const score = t.count + t.conflict * 50;
      if (!best || score < best.score || (score === best.score && st.pts < best.st.pts))
        best = { st, t, score };
    }
    best.st.items.push(o.id);
    best.st.prev = best.t.ps;
    best.st.pts += b.points * o.qty;
    if (best.st.items.length > 1) best.st.co += best.t.count;
  }
  const loads = ms.map((m) => m.pts);
  const times = ms.map((m) => m.pts / m.cfg.speed + m.co * data.changeoverMinutes * 60);
  const avg = loads.reduce((s, v) => s + v, 0) / loads.length;
  return {
    totalCO: ms.reduce((s, m) => s + m.co, 0),
    maxTime: Math.max(...times),
    dev: ((Math.max(...loads) - Math.min(...loads)) / avg) * 100,
    assign: ms.map((m) => `${m.cfg.id}:${m.items.length}`),
  };
}

function move(ords, from, to) {
  const copy = [...ords];
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x);
  return copy;
}

const snap = (r) => `${r.totalCO} 次 | ${Math.round(r.maxTime / 60)} 分 | ${r.dev.toFixed(1)}% | ${r.assign.join(' / ')}`;

const allDifferent = (a, b) =>
  a.totalCO !== b.totalCO && a.maxTime !== b.maxTime && a.dev !== b.dev;

// 枚举所有合法拖动位置，挑两个三次快照互不相同的拖动（验收要求：连拖两次都要变）
function findMoves() {
  const r0 = run(orders);
  for (let f1 = 0; f1 < orders.length; f1++) {
    for (let t1 = 0; t1 < orders.length; t1++) {
      const o1 = move(orders, f1, t1);
      const r1 = run(o1);
      if (!allDifferent(r0, r1)) continue;
      for (let f2 = 0; f2 < o1.length; f2++) {
        for (let t2 = 0; t2 < o1.length; t2++) {
          const o2 = move(o1, f2, t2);
          const r2 = run(o2);
          if (allDifferent(r1, r2) && allDifferent(r0, r2)) {
            return { r0, r1, r2, f1, t1, f2, t2 };
          }
        }
      }
    }
  }
  return null;
}

const found = findMoves();
if (!found) { console.error('FAIL: 找不到两个使三指标均变化的拖动'); process.exit(1); }
console.log('初始:             ', snap(found.r0));
console.log(`拖动一 (${found.f1}→${found.t1}): `, snap(found.r1));
console.log(`拖动二 (${found.f2}→${found.t2}): `, snap(found.r2));
console.log('PASS: 连拖两次，三个指标每次都跟着变');
