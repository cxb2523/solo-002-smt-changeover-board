(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LINE_COLORS = { L1: '#3b82f6', L2: '#8b5cf6', L3: '#0ea5a4' };

  const state = {
    data: null,
    orders: [],
    errors: [],
    machines: [],
    selected: null,
    dragFrom: null,
  };

  const $ = (sel) => document.querySelector(sel);

  async function boot() {
    const [boardsRes, ordersRes] = await Promise.all([
      fetch('data/boards.json'),
      fetch('data/orders.json'),
    ]);
    state.data = await boardsRes.json();
    state.orders = (await ordersRes.json()).orders;
    state.errors = validate(state.data, state.orders);
    recompute();
    render();
    bindOrders();
    window.addEventListener('resize', render);
  }

  // ---------- 导入校验：位号重复 / 槽位被不同料号重复占用 ----------
  function validate(data, orders) {
    const errors = [];
    const slotOwner = {};
    const slotReported = new Set();
    const boardIds = new Set();
    for (const b of data.boards) {
      boardIds.add(b.id);
      const seen = new Set();
      for (const c of b.components) {
        for (const ref of c.refs) {
          if (seen.has(ref)) {
            errors.push(`板子 ${b.id}：位号 ${ref} 重复出现（料号 ${c.part}）`);
          }
          seen.add(ref);
        }
        const prev = slotOwner[c.slot];
        if (prev && prev.part !== c.part) {
          const key = [c.slot, prev.part, c.part].sort().join('|');
          if (!slotReported.has(key)) {
            slotReported.add(key);
            errors.push(`槽位 ${c.slot} 被不同料号重复占用：${prev.part}（${prev.board}）与 ${c.part}（${b.id}）`);
          }
        } else if (!prev) {
          slotOwner[c.slot] = { part: c.part, board: b.id };
        }
      }
    }
    for (const o of orders) {
      if (!boardIds.has(o.boardId)) {
        errors.push(`订单 ${o.id} 引用了不存在的板子 ${o.boardId}`);
      }
    }
    return errors;
  }

  // ---------- 换线计算 ----------
  const boardParts = (b) => new Set(b.components.map((c) => c.part));
  const boardNozzles = (b) => new Set(b.components.map((c) => c.nozzle));

  // prevParts 为 null 表示该机台首块板（首次上料，不计换线次数）
  function transition(machine, prevParts, board) {
    const parts = boardParts(board);
    const added = prevParts ? [...parts].filter((p) => !prevParts.has(p)) : [];
    const removed = prevParts ? [...prevParts].filter((p) => !parts.has(p)) : [];
    const overflow = Math.max(0, parts.size - machine.slots);
    const nozzles = boardNozzles(board);
    const nozzleMissing = [...nozzles].filter((n) => !machine.nozzles.includes(n));
    const nozzleConflict = Math.max(0, nozzles.size - machine.nozzleSlots);
    // 拆/装一颗料站各算一次；超出槽位的料要拆+装；每缺一种吸嘴算换一次吸嘴
    const count = prevParts
      ? added.length + removed.length + overflow * 2 + nozzleMissing.length
      : 0;
    return { added, removed, overflow, nozzleMissing, nozzleConflict, count, parts };
  }

  function recompute() {
    const { machines, boards, changeoverMinutes } = state.data;
    const boardById = Object.fromEntries(boards.map((b) => [b.id, b]));

    // 加急订单先占机台，其余订单按页面上的拖动顺序排
    const seq = state.orders
      .map((order, listIdx) => ({ order, listIdx }))
      .sort((a, b) =>
        (b.order.urgent ? 1 : 0) - (a.order.urgent ? 1 : 0) || a.listIdx - b.listIdx);

    state.machines = machines.map((cfg) => ({
      cfg,
      items: [],
      lastParts: null,
      pts: 0,
      changeovers: 0,
    }));

    for (const { order } of seq) {
      const board = boardById[order.boardId];
      if (!board) continue;
      // 换线优先：选增量换线次数最少的机台；平局选当前贴装点数最少的机台
      let best = null;
      for (const st of state.machines) {
        const tr = transition(st.cfg, st.lastParts, board);
        const score = tr.count + tr.nozzleConflict * 50;
        const better = !best ||
          score < best.score ||
          (score === best.score && st.pts < best.st.pts);
        if (better) best = { st, tr, score };
      }
      best.st.items.push({ order, board, tr: best.tr, pts: board.points * (order.qty || 1) });
      best.st.lastParts = best.tr.parts;
      best.st.pts += board.points * (order.qty || 1);
      if (best.st.items.length > 1) best.st.changeovers += best.tr.count;
    }

    const cmSeconds = changeoverMinutes * 60;
    for (const st of state.machines) {
      st.time = st.pts / st.cfg.speed + st.changeovers * cmSeconds;
    }
  }

  // ---------- 指标 ----------
  function metrics() {
    const loads = state.machines.map((m) => m.pts);
    const totalCO = state.machines.reduce((s, m) => s + m.changeovers, 0);
    const maxTime = Math.max(...state.machines.map((m) => m.time));
    const avg = loads.reduce((s, v) => s + v, 0) / (loads.length || 1);
    const deviation = avg
      ? ((Math.max(...loads) - Math.min(...loads)) / avg) * 100
      : 0;
    return { totalCO, maxTime, deviation };
  }

  function fmtTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec - h * 3600) / 60);
    return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
  }

  function partName(p) {
    const names = state.data.partNames;
    return names && names[p] ? names[p] : '';
  }

  function boardIssues(cfg, tr, board) {
    const issues = [];
    if (tr.parts.size > cfg.slots) {
      issues.push(`槽位不足：需 ${tr.parts.size} 种料，${cfg.id} 仅 ${cfg.slots} 槽（超 ${tr.overflow} 种，需分次上料）`);
    }
    if (tr.nozzleMissing.length) {
      issues.push(`需换吸嘴：${cfg.id} 未装 ${tr.nozzleMissing.join('、')}`);
    }
    if (tr.nozzleConflict > 0) {
      issues.push(`吸嘴位不足：需 ${boardNozzles(board).size} 种吸嘴，${cfg.id} 仅 ${cfg.nozzleSlots} 个吸嘴位`);
    }
    return issues;
  }

  // ---------- 渲染 ----------
  function render() {
    renderStats();
    renderErrors();
    renderMachineCards();
    renderOrders();
    renderLanes();
    if (state.selected) {
      const { mi, ii } = state.selected;
      if (state.machines[mi] && state.machines[mi].items[ii]) showDetail(mi, ii);
      else { state.selected = null; $('#detail').classList.add('hidden'); }
    }
  }

  function renderStats() {
    const m = metrics();
    $('#stats').innerHTML = `
      <div class="stat"><div class="num">${m.totalCO}</div><div class="lbl">总换线次数</div></div>
      <div class="stat"><div class="num">${fmtTime(m.maxTime)}</div><div class="lbl">最长机台时间</div></div>
      <div class="stat"><div class="num">${m.deviation.toFixed(1)}%</div><div class="lbl">贴装点均衡偏差</div></div>`;
  }

  function renderErrors() {
    const box = $('#errors');
    if (!state.errors.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('#error-list').innerHTML = state.errors.map((e) => `<li>${e}</li>`).join('');
  }

  function renderMachineCards() {
    $('#machine-summary').innerHTML = state.machines.map((st) => `
      <div class="mcard">
        <h3>${st.cfg.name}</h3>
        <div class="row"><span>贴装板数</span><b>${st.items.length}</b></div>
        <div class="row"><span>贴装点数</span><b>${st.pts.toLocaleString()}</b></div>
        <div class="row"><span>换线次数</span><b>${st.changeovers}</b></div>
        <div class="row"><span>机台时间</span><b>${fmtTime(st.time)}</b></div>
      </div>`).join('');
  }

  function itemForOrder(orderId) {
    for (const st of state.machines) {
      const idx = st.items.findIndex((it) => it.order.id === orderId);
      if (idx >= 0) return { st, it: st.items[idx], idx };
    }
    return null;
  }

  function renderOrders() {
    const ul = $('#orders');
    ul.innerHTML = '';
    state.orders.forEach((o, idx) => {
      const hit = itemForOrder(o.id);
      const issues = hit ? boardIssues(hit.st.cfg, hit.it.tr, hit.it.board) : [];
      const li = document.createElement('li');
      li.className = 'order';
      li.draggable = true;
      li.dataset.idx = String(idx);
      li.innerHTML = `
        <span class="idx">${idx + 1}</span>
        <span>
          <div>
            <span class="oid">${o.id}</span>
            ${o.urgent ? '<span class="badge urgent">加急</span>' : ''}
            <span class="badge line">${o.line}</span>
          </div>
          <div class="meta">${o.boardId} · 数量 ${o.qty} · ${hit ? hit.it.board.points + ' 点/板' : '板子缺失'}</div>
          ${issues.length ? `<div class="issues">${issues.map((x) => `<span class="issue">⚠ ${x}</span>`).join('')}</div>` : ''}
        </span>
        <span class="machine">${hit ? hit.st.cfg.id : '—'}</span>`;
      ul.appendChild(li);
    });
  }

  function mk(tag, attrs, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }

  function renderLanes() {
    const svg = $('#lanes');
    svg.innerHTML = '';
    const width = Math.max(640, svg.getBoundingClientRect().width);
    const left = 82;
    const trackH = 40;
    const laneGap = 82;
    const height = 30 + state.machines.length * laneGap;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    const maxTime = Math.max(1, ...state.machines.map((m) => m.time));
    const scale = (width - left - 16) / maxTime;
    const cmSeconds = state.data.changeoverMinutes * 60;

    for (let i = 0; i <= 6; i++) {
      const t = (maxTime / 6) * i;
      const x = left + t * scale;
      svg.appendChild(mk('line', { x1: x, y1: 18, x2: x, y2: height - 6,
        stroke: '#e4e9f0', 'stroke-width': 1 }));
      svg.appendChild(mk('text', { x, y: 12, 'text-anchor': 'middle', class: 'axis-label' }, fmtTime(t)));
    }

    state.machines.forEach((st, mi) => {
      const y = 24 + mi * laneGap;
      svg.appendChild(mk('text', { x: 6, y: y + 17, class: 'lane-label' }, st.cfg.id));
      svg.appendChild(mk('text', { x: 6, y: y + 32, class: 'axis-label' },
        `${st.cfg.slots} 槽 / ${st.cfg.speed} 点/秒`));
      svg.appendChild(mk('rect', { x: left, y, width: width - left - 16, height: trackH,
        fill: '#eef2f7', rx: 4 }));

      let cursor = 0;
      st.items.forEach((it, ii) => {
        if (ii > 0 && it.tr.count > 0) {
          const cm = it.tr.count * cmSeconds;
          const w = Math.max(5, cm * scale);
          const r = mk('rect', {
            x: left + cursor * scale, y: y + 6, width: w, height: trackH - 12,
            rx: 2, class: 'changeover-rect' +
              (state.selected && state.selected.mi === mi && state.selected.ii === ii ? ' sel' : ''),
          });
          r.appendChild(mk('title', {}, `换线 ${it.tr.count} 次（点击查看拆料/上料明细）`));
          r.addEventListener('click', () => {
            state.selected = { mi, ii };
            render();
          });
          svg.appendChild(r);
          cursor += cm;
        }
        const placeSec = it.pts / st.cfg.speed;
        const w = Math.max(24, placeSec * scale);
        const issues = boardIssues(st.cfg, it.tr, it.board);
        const rect = mk('rect', {
          x: left + cursor * scale, y, width: w, height: trackH, rx: 3,
          class: 'board-rect' + (issues.length ? ' problem' : ''),
          fill: LINE_COLORS[it.order.line] || '#64748b',
        });
        rect.appendChild(mk('title', {},
          `${it.board.id} ${it.board.name}\n订单 ${it.order.id} ×${it.order.qty} · ${it.pts} 点` +
          (issues.length ? `\n⚠ ${issues.join('\n⚠ ')}` : '')));
        svg.appendChild(rect);
        if (w > 36) {
          svg.appendChild(mk('text', {
            x: left + cursor * scale + 4, y: y + trackH / 2 + 3.5, class: 'board-text',
          }, it.board.id.replace(/^B-[A-Z0-9]+-/, '')));
        }
        cursor += placeSec;
      });
    });
  }

  // ---------- 换线明细 ----------
  function showDetail(mi, ii) {
    const st = state.machines[mi];
    const prev = st.items[ii - 1];
    const cur = st.items[ii];
    const tr = cur.tr;
    const li = (p) => `<li>${p} <span class="meta2">${partName(p)}</span></li>`;
    const box = $('#detail');
    box.classList.remove('hidden');
    box.innerHTML = `
      <h3>${st.cfg.id} 换线：${prev.board.id} → ${cur.board.id}（共 ${tr.count} 次）</h3>
      <div class="cols">
        <div class="col remove">
          <h4>拆下 ${tr.removed.length} 种料</h4>
          <ul>${tr.removed.map(li).join('') || '<li>无</li>'}</ul>
        </div>
        <div class="col add">
          <h4>装上新 ${tr.added.length} 种料</h4>
          <ul>${tr.added.map(li).join('') || '<li>无</li>'}</ul>
        </div>
      </div>
      <div class="note">
        ${tr.overflow ? `⚠ 槽位不足，超出的 ${tr.overflow} 种料需分次上料（计 ${tr.overflow * 2} 次拆/装）；` : ''}
        ${tr.nozzleMissing.length ? `⚠ 更换吸嘴：${tr.nozzleMissing.join('、')}（计 ${tr.nozzleMissing.length} 次）；` : ''}
        重叠保留 ${[...tr.parts].filter((p) => prev && boardParts(prev.board).has(p)).length} 种料不用重上。
      </div>`;
  }

  // ---------- 拖动重排 ----------
  function bindOrders() {
    const ul = $('#orders');
    ul.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.order');
      if (!row) return;
      state.dragFrom = Number(row.dataset.idx);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    ul.addEventListener('dragend', () => {
      ul.querySelectorAll('.order').forEach((el) =>
        el.classList.remove('dragging', 'drag-over'));
    });
    ul.addEventListener('dragover', (e) => {
      e.preventDefault();
      const row = e.target.closest('.order');
      ul.querySelectorAll('.order').forEach((el) => el.classList.remove('drag-over'));
      if (row) row.classList.add('drag-over');
    });
    ul.addEventListener('drop', (e) => {
      e.preventDefault();
      const row = e.target.closest('.order');
      const to = row ? Number(row.dataset.idx) : state.orders.length - 1;
      if (state.dragFrom == null || state.dragFrom === to) return;
      const moved = state.orders.splice(state.dragFrom, 1)[0];
      state.orders.splice(to, 0, moved);
      state.dragFrom = null;
      state.selected = null;
      $('#detail').classList.add('hidden');
      recompute();
      render();
    });
  }

  boot().catch((err) => {
    document.body.insertAdjacentHTML('afterbegin',
      `<div class="errors"><h2>数据加载失败</h2><ul><li>${err.message}</li></ul></div>`);
  });
})();
