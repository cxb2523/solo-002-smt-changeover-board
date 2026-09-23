// 一次性生成样例数据：data/boards.json 和 data/orders.json
// 运行：node tools/gen-data.js
const fs = require('fs');
const path = require('path');

// 可复现的伪随机
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260923);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// 元件目录：料号 -> 封装 / 吸嘴 / 位号前缀 / 单点贴装点数
const COMPONENTS = {
  'RC0603-10K':  { pkg: '0603',   nozzle: 'CN040', ref: 'R', points: 1, desc: '贴片电阻 10K' },
  'RC0603-4K7':  { pkg: '0603',   nozzle: 'CN040', ref: 'R', points: 1, desc: '贴片电阻 4.7K' },
  'RC0805-1K':   { pkg: '0805',   nozzle: 'CN040', ref: 'R', points: 1, desc: '贴片电阻 1K' },
  'RC0805-100R': { pkg: '0805',   nozzle: 'CN040', ref: 'R', points: 1, desc: '贴片电阻 100R' },
  'CC0603-100N': { pkg: '0603',   nozzle: 'CN040', ref: 'C', points: 1, desc: '贴片电容 100nF' },
  'CC0603-10U':  { pkg: '0603',   nozzle: 'CN040', ref: 'C', points: 1, desc: '贴片电容 10uF' },
  'CC0805-1U':   { pkg: '0805',   nozzle: 'CN040', ref: 'C', points: 1, desc: '贴片电容 1uF' },
  'LED-0603-R':  { pkg: '0603',   nozzle: 'CN040', ref: 'D', points: 1, desc: '红色 LED' },
  'L0805-10UH':  { pkg: '0805',   nozzle: 'CN065', ref: 'L', points: 1, desc: '功率电感 10uH' },
  'D-SOD123':    { pkg: 'SOD123', nozzle: 'CN065', ref: 'D', points: 1, desc: '肖特基二极管' },
  'XTL-3225':    { pkg: '3225',   nozzle: 'CN065', ref: 'Y', points: 1, desc: '无源晶振 16M' },
  'IC-SOP8':     { pkg: 'SOP8',   nozzle: 'CN065', ref: 'U', points: 2, desc: '电源管理 IC' },
  'IC-QFN32':    { pkg: 'QFN32',  nozzle: 'CN140', ref: 'U', points: 3, desc: '单片机 QFN32' },
  'IC-QFP64':    { pkg: 'QFP64',  nozzle: 'CN140', ref: 'U', points: 3, desc: '主控 QFP64' },
  'CON-USB-C':   { pkg: 'USBC',   nozzle: 'CN140', ref: 'J', points: 2, desc: 'USB-C 连接器' },
  'CON-HEADER':  { pkg: 'DIP8',   nozzle: 'CN220', ref: 'J', points: 2, desc: '排针 2x4' },
  'MOD-WIFI':    { pkg: 'MODULE', nozzle: 'CN220', ref: 'M', points: 4, desc: 'WiFi 模组' },
  'RELAY-24V':   { pkg: 'RELAY',  nozzle: 'CN400', ref: 'K', points: 3, desc: '大功率继电器' },
  'RC0603-100K': { pkg: '0603',   nozzle: 'CN040', ref: 'R', points: 1, desc: '贴片电阻 100K' },
  'RC1206-10R':  { pkg: '1206',   nozzle: 'CN040', ref: 'R', points: 1, desc: '贴片电阻 10R' },
  'CC1206-100U': { pkg: '1206',   nozzle: 'CN065', ref: 'C', points: 1, desc: '贴片电容 100uF' },
  'TR-SOT23':    { pkg: 'SOT23',  nozzle: 'CN040', ref: 'Q', points: 1, desc: '三极管 SOT23' },
  'D-SMA':       { pkg: 'SMA',    nozzle: 'CN065', ref: 'D', points: 1, desc: 'TVS 二极管' },
  'LED-0805-G':  { pkg: '0805',   nozzle: 'CN040', ref: 'D', points: 1, desc: '绿色 LED' },
  'IC-SOT23-5':  { pkg: 'SOT235', nozzle: 'CN040', ref: 'U', points: 1, desc: 'LDO 稳压器' },
  'CON-FPC':     { pkg: 'FPC12',  nozzle: 'CN140', ref: 'J', points: 2, desc: 'FPC 座 12P' },
};

// 三台贴片机：槽位数 / 速度(点每分钟) / 已装吸嘴 / 吸嘴库（能换上的上限）
const MACHINES = [
  {
    id: 'M1', name: 'M1 高速机', slots: 16, speed: 2600,
    nozzles: { CN040: 4, CN065: 2, CN140: 1 },
    magazine: { CN040: 4, CN065: 2, CN140: 1, CN220: 1 },
    setup: [
      { slot: 1, pn: 'RC0603-10K' }, { slot: 2, pn: 'CC0603-100N' },
      { slot: 3, pn: 'RC0603-4K7' }, { slot: 4, pn: 'CC0603-10U' },
    ],
  },
  {
    id: 'M2', name: 'M2 中速机', slots: 12, speed: 2000,
    nozzles: { CN040: 2, CN065: 2 },
    magazine: { CN040: 2, CN065: 2, CN140: 1, CN220: 1 },
    setup: [
      { slot: 1, pn: 'RC0603-10K' },
      { slot: 2, pn: 'RC0805-1K' }, { slot: 3, pn: 'CC0805-1U' },
    ],
  },
  {
    id: 'M3', name: 'M3 泛用机', slots: 20, speed: 1500,
    nozzles: { CN040: 4, CN065: 2, CN140: 1 },
    magazine: { CN040: 4, CN065: 2, CN140: 1 },
    setup: [
      { slot: 1, pn: 'RC0805-100R' }, { slot: 2, pn: 'CC0603-100N' },
      { slot: 2, pn: 'D-SOD123' },
      { slot: 4, pn: 'L0805-10UH' },
    ],
  },
];

// 产品族：同族板子共享大部分料，换线才有“重叠多/少”的差异
const FAMILIES = {
  ctrl:  ['RC0603-10K', 'RC0603-4K7', 'RC0805-1K', 'CC0603-100N', 'CC0603-10U',
          'IC-QFN32', 'IC-QFP64', 'XTL-3225', 'LED-0603-R', 'CON-USB-C', 'IC-SOP8',
          'RC0603-100K', 'TR-SOT23', 'LED-0805-G', 'IC-SOT23-5', 'CON-FPC', 'CC0805-1U',
          'RC0805-100R', 'D-SMA'],
  power: ['RC0805-1K', 'RC0805-100R', 'CC0805-1U', 'CC0603-10U', 'L0805-10UH',
          'D-SOD123', 'IC-SOP8', 'LED-0603-R', 'CON-HEADER', 'RC0603-10K',
          'RC1206-10R', 'CC1206-100U', 'TR-SOT23', 'D-SMA', 'IC-SOT23-5', 'LED-0805-G',
          'RC0603-100K', 'CON-FPC', 'XTL-3225'],
  comm:  ['RC0603-10K', 'CC0603-100N', 'MOD-WIFI', 'CON-USB-C', 'CON-HEADER',
          'IC-QFN32', 'XTL-3225', 'LED-0603-R', 'CC0603-10U', 'RC0603-4K7',
          'RC0603-100K', 'TR-SOT23', 'CON-FPC', 'IC-SOT23-5', 'D-SMA', 'LED-0805-G',
          'CC0805-1U', 'RC0805-1K'],
};

const BOARD_DEFS = [
  ['BD-1001', '主控板 A',   'ctrl',  12],
  ['BD-1002', '主控板 B',   'ctrl',  10],
  ['BD-1003', '显示接口板', 'ctrl',  14],
  ['BD-1004', '按键小板',   'ctrl',   7],
  ['BD-2001', '电源板 A',   'power', 11],
  ['BD-2002', '电源板 B',   'power', 13],
  ['BD-2003', '充电管理板', 'power',  9],
  ['BD-2004', '功放电源板', 'power', 15],
  ['BD-3001', 'WiFi 通信板', 'comm',  12],
  ['BD-3002', '蓝牙网关板', 'comm',  16],
  ['BD-3003', '4G 转接板',  'comm',  10],
  ['BD-3004', '传感集线板', 'comm',  18],
  ['BD-9001', '老版电源板', 'power',  8],
  ['BD-9002', '测试工装板', 'ctrl',   9],
];

function buildBoard(id, name, family, partCount, withRelay, withDupRef) {
  const pool = FAMILIES[family];
  partCount = Math.min(partCount, pool.length);
  const pns = [];
  while (pns.length < partCount) {
    const pn = pick(pool);
    if (!pns.includes(pn)) pns.push(pn);
  }
  if (withRelay && !pns.includes('RELAY-24V')) pns.push('RELAY-24V');
  const counters = {};
  const placements = [];
  for (const pn of pns) {
    const comp = COMPONENTS[pn];
    const copies = comp.points >= 3 ? 1 : int(1, 3);
    for (let i = 0; i < copies; i++) {
      counters[comp.ref] = (counters[comp.ref] || 0) + 1;
      placements.push({ ref: comp.ref + counters[comp.ref], pn, points: comp.points });
    }
  }
  if (withDupRef) placements.push({ ref: 'R1', pn: 'RC0805-1K', points: 1 });
  return { id, name, family, placements };
}

const boards = BOARD_DEFS.map(([id, name, fam, n]) =>
  buildBoard(id, name, fam, n, id === 'BD-9001', id === 'BD-9002'));

// 三条产线，每条 13 张订单；每条线内板子不重复，保证任意拖动都会改变排产结果
const LINES = ['L1', 'L2', 'L3'];
const orders = [];
let seq = 8801;
for (const line of LINES) {
  const pool = boards.map((b) => b.id).filter((id) => id !== 'BD-9001' || line === 'L2');
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
  }
  const chosen = shuffled.slice(0, 13);
  chosen.forEach((boardId, idx) => {
    orders.push({
      id: 'PO-' + seq++,
      line,
      boardId,
      qty: int(4, 24) * 10,
      rush: idx === 2 || idx === 7,
    });
  });
}

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const out = (file, obj) =>
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(obj, null, 2) + '\n');

out('boards.json', { components: COMPONENTS, machines: MACHINES, boards });
out('orders.json', { orders });
console.log('generated:', boards.length, 'boards,', orders.length, 'orders');
