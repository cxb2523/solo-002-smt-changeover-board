// 一次性样例数据生成器：node tools/gen-data.js
const fs = require('fs');
const path = require('path');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260924);
const pickN = (arr, n) => {
  const c = [...arr]; const out = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
  return out;
};

const parts = [];
const rNames = ['1kΩ', '4.7kΩ', '10kΩ', '47kΩ', '100kΩ', '0.1µF', '1µF', '10µF',
  '22pF', '100nF', '330Ω', '2.2kΩ', '1nF', '4.7µF'];
for (let i = 0; i < 14; i++) {
  parts.push({ part: `P-R${String(i + 1).padStart(2, '0')}`, name: `片式 ${rNames[i]} 0402`,
    nozzle: 'N1', slot: `S${String(i + 1).padStart(2, '0')}` });
}
const icNames = ['MCU STM32G4', 'LDO 3.3V', '运放 SOT23-5', 'CAN 收发器', 'Flash 16Mbit',
  '电平转换 IC', 'EEPROM 8Kbit', '栅极驱动器'];
for (let i = 0; i < 8; i++) {
  parts.push({ part: `P-IC${i + 1}`, name: icNames[i], nozzle: 'N2',
    slot: `S${String(15 + i).padStart(2, '0')}` });
}
const cnNames = ['板对板连接器 40P', 'FPC 连接器 12P', '端子台 4P', 'USB-C 母座', '排针 2x8'];
for (let i = 0; i < 5; i++) {
  parts.push({ part: `P-CN${i + 1}`, name: cnNames[i], nozzle: 'N3',
    slot: `S${String(23 + i).padStart(2, '0')}` });
}
// 故意制造的导入校验样例：P-CN2 与 P-IC5 同时占用 S19
parts.find(p => p.part === 'P-CN2').slot = 'S19';
const partMap = Object.fromEntries(parts.map(p => [p.part, p]));

const n1 = parts.filter(p => p.nozzle === 'N1');
const n2 = parts.filter(p => p.nozzle === 'N2');
const n3 = parts.filter(p => p.nozzle === 'N3');
const cores = {
  L1: [...pickN(n1, 8), ...pickN(n2, 3)],
  L2: [...pickN(n1, 7), ...pickN(n2, 3), ...pickN(n3, 2)],
  L3: [...pickN(n1, 9), ...pickN(n2, 2)],
};
const lineNames = { L1: '电源产品线', L2: '网关产品线', L3: '显示产品线' };

function makeBoard(line, idx) {
  const id = `B-${line}-${String(idx + 1).padStart(2, '0')}`;
  const core = cores[line];
  // 同族板保留核心料的 60%~100%，模拟连续板之间的料站重叠
  let chosen = core.filter(() => rnd() < 0.65);
  if (chosen.length < 5) chosen = pickN(core, 5);
  const pool = parts.filter(p => !chosen.includes(p));
  let extra = 2 + Math.floor(rnd() * 3);
  if (idx === 5 || idx === 9) extra += 9; // 大板：元件种类超过部分机台槽位
  if (line === 'L2' && idx % 4 === 1) chosen = [...chosen, ...pickN(n3, 1)];
  chosen = [...chosen, ...pickN(pool, Math.min(extra, pool.length))];
  if (idx === 5) chosen = [...chosen, ...pickN(n3.filter(p => !chosen.includes(p)), 2)];

  let refCounter = 0;
  let dupRefDone = false;
  const components = chosen.map(p => {
    const count = p.nozzle === 'N1' ? 4 + Math.floor(rnd() * 20)
      : p.nozzle === 'N2' ? 1 + Math.floor(rnd() * 3)
        : 1 + Math.floor(rnd() * 2);
    const prefix = p.nozzle === 'N1' ? 'R' : p.nozzle === 'N2' ? 'U' : 'J';
    const refs = Array.from({ length: count }, () => `${prefix}${++refCounter}`);
    // 故意重复位号样例：B-L2-08 中只出现一次重复
    if (line === 'L2' && idx === 7 && p.nozzle === 'N1' && !dupRefDone) {
      refs.push('R12');
      dupRefDone = true;
    }
    return { part: p.part, slot: p.slot, nozzle: p.nozzle, refs };
  });
  const points = components.reduce((s, c) => s + c.refs.length, 0);
  return {
    id,
    name: `${lineNames[line]} PCBA V${1 + Math.floor(idx / 4)}.${idx % 4}`,
    line,
    points,
    components,
  };
}

const boards = [];
for (const line of ['L1', 'L2', 'L3']) {
  for (let i = 0; i < 12; i++) boards.push(makeBoard(line, i));
}

const boardsData = {
  changeoverMinutes: 2,
  nozzleNames: { N1: '小型片式吸嘴', N2: 'IC 精密吸嘴', N3: '异型/连接器吸嘴' },
  partNames: Object.fromEntries(parts.map(p => [p.part, p.name])),
  machines: [
    { id: 'M1', name: 'M1 高速贴片机', slots: 20, nozzleSlots: 4,
      nozzles: ['N1', 'N2'], speed: 16 },
    { id: 'M2', name: 'M2 泛用贴片机', slots: 16, nozzleSlots: 4,
      nozzles: ['N1', 'N2', 'N3'], speed: 11 },
    { id: 'M3', name: 'M3 异型贴片机', slots: 24, nozzleSlots: 6,
      nozzles: ['N1', 'N3'], speed: 8 },
  ],
  boards,
};

const orders = [];
let po = 1001;
for (const line of ['L1', 'L2', 'L3']) {
  boards.filter(b => b.line === line).forEach((b, i) => {
    orders.push({
      id: `PO-${po++}`,
      line,
      boardId: b.id,
      qty: 20 + Math.floor(rnd() * 90),
      urgent: (line === 'L1' && i === 2) || (line === 'L2' && i === 0) ||
        (line === 'L3' && i === 4),
    });
  });
}

const dir = path.join(__dirname, '..', 'data');
fs.writeFileSync(path.join(dir, 'boards.json'), JSON.stringify(boardsData, null, 2));
fs.writeFileSync(path.join(dir, 'orders.json'), JSON.stringify({ orders }, null, 2));
console.log(`boards=${boards.length} orders=${orders.length}`);
