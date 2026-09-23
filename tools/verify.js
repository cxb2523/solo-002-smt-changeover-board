// 验收脚本：node tools/verify.js
// 1) 样例数据能排产并给出三个指标
// 2) 模拟“拖动订单”（交换两张订单位置），每条线任意相邻交换后三个指标至少一个变化
// 3) 导入校验能报出样例里故意埋的问题
const fs = require('fs');
const path = require('path');
const S = require('../public/scheduler.js');

const boardsData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'boards.json'), 'utf8'));
const ordersData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'orders.json'), 'utf8'));
const { components, machines, boards } = boardsData;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) fail++; };

const problems = S.validate(boardsData);
console.log('导入校验输出：');
problems.forEach((p) => console.log('  [' + p.level + '] ' + p.text));
ok(problems.some((p) => p.text.includes('出现两次')), '检出重复位号');
ok(problems.some((p) => p.text.includes('重复占用') && p.text.includes('号槽')), '检出槽位重复占用');

const lines = [...new Set(ordersData.orders.map((o) => o.line))];
for (const line of lines) {
  const orders = ordersData.orders.filter((o) => o.line === line);
  const base = S.schedule(orders, machines, boards, components);
  const m0 = base.metrics;
  console.log('\n' + line + ': 换线=' + m0.totalChangeovers + ' 最长机台=' + m0.longestTime + 'min 均衡偏差=' + m0.balanceDev + '%');
  ok(m0.totalChangeovers > 0, line + ' 有换线事件');
  ok(m0.longestTime > 0, line + ' 有机台时间');
  let allChanged = true;
  for (let i = 0; i < orders.length - 1; i++) {
    const swapped = orders.slice();
    const t = swapped[i]; swapped[i] = swapped[i + 1]; swapped[i + 1] = t;
    const m1 = S.schedule(swapped, machines, boards, components).metrics;
    const changed = m1.totalChangeovers !== m0.totalChangeovers ||
                    m1.longestTime !== m0.longestTime ||
                    m1.balanceDev !== m0.balanceDev;
    if (!changed) {
      allChanged = false;
      console.log('  相邻交换 ' + orders[i].id + ' <-> ' + orders[i + 1].id + ' 指标未变');
    }
  }
  ok(allChanged, line + ' 任意相邻拖动后指标都会重算变化');
}

process.exit(fail ? 1 : 0);
