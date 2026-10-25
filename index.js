/**
 * dsh-pet-plus —— 蓝毛小女仆的伴生插件（host 半侧）
 * ------------------------------------------------------------------
 * 不碰 dsh-pet 的代码，只通过它公开的本地接口驱动桌宠：
 *   POST /dsh-pet-7340/broadcast?pet=main&surface=any   { text, duration, anim:false }
 *   POST /dsh-pet-7340/anim?pet=main&surface=any        { name }
 *
 * 功能：
 *   1. 喂食（饱食度，本地持久化）
 *   2. 番茄钟 + 喝水提醒
 *   3. 系统徽章（CPU / 内存 / 电量）
 *   4. 任务进度气泡（监听 DSH 的 todo/write 事件）
 *
 * 斜杠命令：/feed /petstatus /stats /focus /water /progress /petplus
 * 数据文件：$DSH_HOME/dsh-pet-plus/state.json（默认 ~/.dsh/dsh-pet-plus/state.json）
 * 环境变量：DSH_PET_PLUS_ID（默认 main）、DSH_PET_PLUS_SURFACE（默认 any）
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { cpus, freemem, homedir, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'pet-plus';
export const inject = ['webServer', 'commands'];

const MIN = 60 * 1000;
const HUNGER_MS = 4 * MIN;          // 每 4 分钟掉 1 点饱食
const FEED_HUNGER = 25;
const HUNGRY_LEVEL = 30;
const HUNGRY_NAG_MS = 30 * MIN;
const BATTERY_CHECK_MS = 10 * MIN;
const BATTERY_ALERT_MS = 60 * MIN;
const TODO_THROTTLE_MS = 2500;

const PET_ID = process.env.DSH_PET_PLUS_ID || 'main';
const SURFACE = process.env.DSH_PET_PLUS_SURFACE || 'any';
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const DATA_DIR = join(DSH_HOME, 'dsh-pet-plus');
const STATE_FILE = join(DATA_DIR, 'state.json');
const PANEL_PID = join(DATA_DIR, 'panel.pid');
const PANEL_SCRIPT = join(fileURLToPath(new URL('.', import.meta.url)), 'panel.py');

const FEED_LINES = ['谢谢主人～小鱼干最好吃了', '呜，吃饱啦', '主人喂的就是香', '本女仆记下了'];
const FULL_LINES = ['吃不下了…肚皮要撑破了', '留着下一顿吧，主人'];
const HUNGRY_LINES = ['主人…肚子有点饿了', '想吃白饭…', '有小鱼干吗？'];
const FEED_ANIMS = ['吃午餐', '吃白饭', '大口吃零食'];

const DEFAULT_STATE = {
  hunger: 70,
  lastHungryNag: 0,
  lastBatteryAlert: 0,
  focusEnd: 0,
  waterInterval: 0,
  waterNext: 0,
  lastSeen: 0,
};

let state = { ...DEFAULT_STATE };
let getPort = () => 0;
let cpuPrev = null;
let cpuPct = 0;
let cpuReady = false;
let battery = null;
let lastBatteryCheck = 0;
let lastTick = Date.now();
let lastSave = 0;
let saveTimer = null;
let warnedNoPort = false;
let lastTodoSig = '';
let lastTodoAt = 0;
let lastTodo = { done: 0, total: 0, current: '', at: 0 };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function truncate(text, max) {
  const chars = Array.from(String(text));
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('');
}

function loadState() {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    raw = {};
  }
  state = { ...DEFAULT_STATE, ...(raw && typeof raw === 'object' ? raw : {}) };
  // 旧版本的心情 / 好感 / 喂食次数不再使用
  delete state.mood;
  delete state.affection;
  delete state.feeds;
  const now = Date.now();
  const lastSeen = num(state.lastSeen, 0);
  const away = lastSeen > 0 ? Math.min(12 * 60 * MIN, Math.max(0, now - lastSeen)) : 0;
  state.hunger = clamp(num(state.hunger, 70) - away / HUNGER_MS, 0, 100);
  if (state.focusEnd && state.focusEnd < now) state.focusEnd = 0;
  if (state.waterInterval > 0 && (!state.waterNext || state.waterNext < now)) {
    state.waterNext = now + state.waterInterval;
  }
}

function saveNow() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    state.lastSeen = Date.now();
    state.port = getPort() || state.port || 0;
    const tmp = STATE_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    renameSync(tmp, STATE_FILE);
    lastSave = Date.now();
  } catch (e) {
    console.warn('[dsh-pet-plus] 保存状态失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 800);
}

function sampleCpu() {
  const list = cpus();
  let idle = 0;
  let total = 0;
  for (const c of list) {
    for (const k of Object.keys(c.times)) total += c.times[k];
    idle += c.times.idle;
  }
  if (cpuPrev) {
    const dt = total - cpuPrev.total;
    const di = idle - cpuPrev.idle;
    if (dt > 0) {
      cpuPct = clamp((1 - di / dt) * 100, 0, 100);
      cpuReady = true;
    }
  }
  cpuPrev = { total, idle };
}

function postJson(path, payload) {
  return new Promise((resolve) => {
    const port = getPort();
    if (!port) {
      if (!warnedNoPort) {
        warnedNoPort = true;
        console.warn('[dsh-pet-plus] 没有拿到 DSH webServer 端口，桌宠气泡不可用');
      }
      resolve({ error: new Error('no-port') });
      return;
    }
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/dsh-pet-7340' + path,
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = null;
          }
          if (parsed && parsed.ok === false) {
            console.warn('[dsh-pet-plus] 桌宠接口拒绝：' + (parsed.message || parsed.reason || body));
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', (e) => resolve({ error: e }));
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.end(data);
  });
}

function petQuery() {
  return '?pet=' + encodeURIComponent(PET_ID) + '&surface=' + encodeURIComponent(SURFACE);
}

function say(text, duration) {
  return postJson('/broadcast' + petQuery(), {
    text,
    duration: typeof duration === 'number' ? duration : 10000,
    anim: false,
  });
}

function play(anim) {
  return postJson('/anim' + petQuery(), { name: anim });
}

function readBattery() {
  return new Promise((resolve) => {
    const script =
      "$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; " +
      "if ($b) { Write-Output ($b.EstimatedChargeRemaining.ToString() + ',' + $b.BatteryStatus) }";
    const done = (err, stdout) => {
      if (err) return resolve(null);
      const line = String(stdout || '').trim().split(/\r?\n/).pop() || '';
      const [pctRaw, statusRaw] = line.split(',');
      const pct = Number(pctRaw);
      if (!Number.isFinite(pct)) return resolve(null);
      const status = Number(statusRaw);
      resolve({ pct: clamp(Math.round(pct), 0, 100), charging: status !== 1 });
    };
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 3500, windowsHide: true },
        done,
      );
    } catch {
      resolve(null);
    }
  });
}

async function refreshBattery() {
  lastBatteryCheck = Date.now();
  const b = await readBattery();
  if (!b) return;
  battery = b;
  if (b.pct <= 20 && !b.charging && Date.now() - state.lastBatteryAlert > BATTERY_ALERT_MS) {
    state.lastBatteryAlert = Date.now();
    void say('电量只剩 ' + b.pct + '% 了，记得充电', 10000);
    void play('被吓一跳');
    saveSoon();
  }
}

function statsText() {
  const mem = Math.round((1 - freemem() / totalmem()) * 100);
  let text = 'CPU ' + (cpuReady ? Math.round(cpuPct) + '%' : '--') + ' · 内存 ' + mem + '%';
  if (battery && Number.isFinite(battery.pct)) {
    text += ' · 电量 ' + battery.pct + '%' + (battery.charging ? '（充电中）' : '');
  }
  return text;
}

function feed() {
  if (state.hunger >= 95) {
    void say(pick(FULL_LINES), 8000);
    return { kind: 'success', text: '她吃不下了（饱食 ' + Math.round(state.hunger) + '%）' };
  }
  state.hunger = clamp(state.hunger + FEED_HUNGER, 0, 100);
  void say(pick(FEED_LINES), 9000);
  void play(pick(FEED_ANIMS));
  saveSoon();
  return {
    kind: 'success',
    text: '已喂食，饱食 ' + Math.round(state.hunger) + '%',
  };
}

function status() {
  const text = '饱食 ' + Math.round(state.hunger) + '%';
  void say(text, 12000);
  return { kind: 'success', text };
}

function stats() {
  if (Date.now() - lastBatteryCheck > BATTERY_CHECK_MS) void refreshBattery();
  const text = statsText();
  void say(text, 12000);
  return { kind: 'success', text };
}

function focus(raw, quiet = false) {
  const arg = String(raw || '').trim().toLowerCase();
  const now = Date.now();
  if (!arg) {
    const left = state.focusEnd > now ? Math.ceil((state.focusEnd - now) / MIN) : 0;
    const text = left > 0 ? '专注中，还剩 ' + left + ' 分钟' : '现在没有在专注（/focus 25 开始）';
    void say(text, 8000);
    return { kind: 'success', text };
  }
  if (arg === 'stop' || arg === 'off' || arg === '取消' || arg === '停') {
    state.focusEnd = 0;
    saveSoon();
    void say('专注结束啦，辛苦主人了', 8000);
    void play('超大伸懒腰');
    return { kind: 'success', text: '已结束专注' };
  }
  const minutes = clamp(parseInt(arg.replace(/[^0-9]/g, ''), 10) || 25, 1, 180);
  state.focusEnd = now + minutes * MIN;
  saveSoon();
  if (!quiet) {
    void say('专注 ' + minutes + ' 分钟，我陪着主人～', 10000);
    void play('写代码');
  }
  return { kind: 'success', text: '番茄钟：' + minutes + ' 分钟，开始' };
}

function water(raw) {
  const arg = String(raw || '').trim().toLowerCase();
  const now = Date.now();
  if (!arg) {
    const text =
      state.waterInterval > 0
        ? '喝水提醒：每 ' + Math.round(state.waterInterval / MIN) + ' 分钟一次'
        : '喝水提醒没开（/water 45 开启，/water off 关闭）';
    void say(text, 8000);
    return { kind: 'success', text };
  }
  if (arg === 'off' || arg === 'stop' || arg === '关') {
    state.waterInterval = 0;
    state.waterNext = 0;
    saveSoon();
    void say('喝水提醒关掉啦', 7000);
    return { kind: 'success', text: '已关闭喝水提醒' };
  }
  const minutes = clamp(parseInt(arg.replace(/[^0-9]/g, ''), 10) || 45, 1, 240);
  state.waterInterval = minutes * MIN;
  state.waterNext = now + minutes * MIN;
  saveSoon();
  void say('好，每 ' + minutes + ' 分钟提醒主人喝水', 9000);
  return { kind: 'success', text: '喝水提醒：每 ' + minutes + ' 分钟' };
}

function progress(raw) {
  const m = String(raw || '').trim().match(/^(\d+)\s*\/\s*(\d+)\s*(.*)$/);
  if (!m) return { kind: 'error', text: '格式：/progress 3/7 写插件' };
  const done = clamp(parseInt(m[1], 10), 0, 999);
  const total = clamp(parseInt(m[2], 10), 1, 999);
  const label = m[3] ? ' · ' + truncate(m[3], 16) : '';
  const text = '任务 ' + Math.min(done, total) + '/' + total + label;
  lastTodo = { done: Math.min(done, total), total, current: m[3] || '', at: Date.now() };
  void say(text, 8000);
  return { kind: 'success', text };
}

function help() {
  const text = '/feed 喂食 · /petstatus 状态 · /stats 系统 · /focus 25 · /water 45 · /progress 3/7 文案 · /panel 控制台';
  void say('主人，我学会了新口令～', 8000);
  return { kind: 'success', text };
}

function stateSnapshot() {
  const now = Date.now();
  return {
    hunger: Math.round(state.hunger * 10) / 10,
    focusLeftSec: state.focusEnd ? Math.max(0, Math.ceil((state.focusEnd - now) / 1000)) : 0,
    waterIntervalSec: Math.round(state.waterInterval / 1000),
    waterLeftSec: state.waterNext ? Math.max(0, Math.ceil((state.waterNext - now) / 1000)) : 0,
    todo: lastTodo,
    port: getPort(),
  };
}

function runAction(name, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  switch (name) {
    case 'feed':
      return feed();
    case 'status':
      return status();
    case 'stats':
      return stats();
    case 'focus':
      return focus(p.minutes != null ? String(p.minutes) : '25', p.quiet === true);
    case 'focus-stop':
      return focus('stop');
    case 'water':
      return water(p.minutes != null ? String(p.minutes) : '45');
    case 'water-off':
      return water('off');
    case 'progress':
      return progress(String(p.done ?? 0) + '/' + String(p.total ?? 1) + ' ' + String(p.label ?? ''));
    case 'panel':
      void ensurePanel();
      return { kind: 'success', text: '正在打开小女仆控制台' };
    case 'panel-restart': {
      const ok = restartPanel();
      return {
        kind: ok ? 'success' : 'error',
        text: ok ? '小女仆控制台已重启' : '控制台重启失败（可能权限不同）',
      };
    }
    default:
      return { kind: 'error', text: '未知操作：' + name };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readPanelPid() {
  try {
    return parseInt(readFileSync(PANEL_PID, 'utf8').trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function panelAlive() {
  const pid = readPanelPid();
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return Boolean(e && e.code === 'EPERM');
  }
}

function restartPanel() {
  const pid = readPanelPid();
  if (pid > 0 && panelAlive()) {
    try {
      process.kill(pid);
    } catch {
      return false;
    }
  }
  try {
    unlinkSync(PANEL_PID);
  } catch {
    /* already gone */
  }
  setTimeout(() => {
    void ensurePanel();
  }, 900);
  return true;
}

function ensurePanel() {
  if (panelAlive()) return true;
  const candidates = [
    join(homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'pythonw.exe'),
    'pythonw.exe',
  ];
  for (const py of candidates) {
    if (py.includes('\\') && !existsSync(py)) continue;
    try {
      const child = spawn(py, [PANEL_SCRIPT], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function onSessionEvent(_session, event) {
  if (!event || event.type !== 'todo/write') return;
  const todos = event.data && Array.isArray(event.data.todos) ? event.data.todos : null;
  if (!todos || todos.length === 0) return;
  const total = todos.length;
  const done = todos.filter((t) => t && t.status === 'completed').length;
  const current =
    todos.find((t) => t && t.status === 'in_progress') || todos.find((t) => t && t.status === 'pending');
  lastTodo = { done, total, current: (current && current.content) || '', at: Date.now() };
  const sig = done + '/' + total + ':' + ((current && current.content) || '');
  if (sig === lastTodoSig) return;
  lastTodoSig = sig;
  const now = Date.now();
  if (now - lastTodoAt < TODO_THROTTLE_MS) return;
  lastTodoAt = now;
  const label = current && current.content ? ' · ' + truncate(current.content, 14) : '';
  void say('任务 ' + done + '/' + total + label, 7000);
  if (done === total) void play('工作状态-雀跃庆祝');
}

function tick() {
  const now = Date.now();
  const dt = Math.min(6 * 60 * MIN, Math.max(0, now - lastTick));
  lastTick = now;

  state.hunger = clamp(state.hunger - dt / HUNGER_MS, 0, 100);
  sampleCpu();

  if (state.hunger < HUNGRY_LEVEL && now - state.lastHungryNag > HUNGRY_NAG_MS) {
    state.lastHungryNag = now;
    void say(pick(HUNGRY_LINES), 9000);
    void play('工作状态-垂头叹气冒汗');
    saveSoon();
  }

  if (state.focusEnd && now >= state.focusEnd) {
    state.focusEnd = 0;
    void say('时间到啦，起来伸个懒腰吧', 10000);
    void play('超大伸懒腰');
    saveSoon();
  }

  if (state.waterInterval > 0 && state.waterNext && now >= state.waterNext) {
    state.waterNext = now + state.waterInterval;
    void say('该喝水啦，主人', 9000);
    void play('玩水枪');
    saveSoon();
  }

  if (now - lastBatteryCheck > BATTERY_CHECK_MS) void refreshBattery();
  if (now - lastSave > 5 * MIN) saveNow();
}

/**
 * Cordis 插件入口。
 * @param {any} ctx DSH 注入的上下文（webServer / commands / effect / on）
 */
export function apply(ctx) {
  getPort = () => (typeof ctx.webServer?.port === 'number' ? ctx.webServer.port : 0);
  loadState();
  sampleCpu();

  const register = (spec) => () => ctx.commands.register(spec);

  ctx.effect(
    register({
      name: 'feed',
      description: '喂蓝毛小女仆吃东西（饱食 +25）',
      handler: () => feed(),
    }),
    'dsh-pet-plus: /feed',
  );
  ctx.effect(
    register({
      name: 'petstatus',
      description: '查看小女仆的饱食度',
      handler: () => status(),
    }),
    'dsh-pet-plus: /petstatus',
  );
  ctx.effect(
    register({
      name: 'stats',
      description: '把小女仆当系统徽章：CPU / 内存 / 电量',
      handler: () => stats(),
    }),
    'dsh-pet-plus: /stats',
  );
  ctx.effect(
    register({
      name: 'focus',
      description: '番茄钟：/focus 25 开始，/focus stop 结束，留空看剩余',
      input: { hint: '[分钟 | stop]' },
      handler: ({ rawInput }) => focus(rawInput),
    }),
    'dsh-pet-plus: /focus',
  );
  ctx.effect(
    register({
      name: 'water',
      description: '喝水提醒：/water 45 开启，/water off 关闭',
      input: { hint: '[分钟 | off]' },
      handler: ({ rawInput }) => water(rawInput),
    }),
    'dsh-pet-plus: /water',
  );
  ctx.effect(
    register({
      name: 'progress',
      description: '手动让桌宠显示任务进度：/progress 3/7 写插件',
      input: { hint: '完成数/总数 [文案]' },
      handler: ({ rawInput }) => progress(rawInput),
    }),
    'dsh-pet-plus: /progress',
  );
  ctx.effect(
    register({
      name: 'petplus',
      description: 'dsh-pet-plus 的用法提示',
      handler: () => help(),
    }),
    'dsh-pet-plus: /petplus',
  );
  ctx.effect(
    register({
      name: 'panel',
      description: '打开小女仆控制台（喂食 / 番茄钟 / 喝水 / 任务进度）',
      handler: () => runAction('panel'),
    }),
    'dsh-pet-plus: /panel',
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/dsh-pet-plus',
        handler: async (req, res) => {
          const remote = (req.socket && req.socket.remoteAddress) || '';
          if (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
            sendJson(res, 403, { ok: false, error: 'loopback only' });
            return;
          }
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          const path = url.pathname.replace(/\/+$/, '');
          try {
            if (req.method === 'GET' && path === '/dsh-pet-plus/state') {
              sendJson(res, 200, { ok: true, state: stateSnapshot() });
              return;
            }
            if (req.method === 'POST' && path === '/dsh-pet-plus/action') {
              const raw = await readBody(req);
              if (raw.length > 4096) {
                sendJson(res, 413, { ok: false, error: 'body too large' });
                return;
              }
              let body;
              try {
                body = raw ? JSON.parse(raw) : {};
              } catch {
                sendJson(res, 400, { ok: false, error: 'invalid json' });
                return;
              }
              const result = runAction(String(body.action || ''), body);
              sendJson(res, 200, { ok: result.kind === 'success', kind: result.kind, text: result.text });
              return;
            }
            sendJson(res, 404, { ok: false, error: 'not found' });
          } catch (e) {
            sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        },
      }),
    'dsh-pet-plus: local api',
  );

  ctx.effect(() => {
    if (process.env.DSH_PET_PLUS_PANEL === '0') return () => {};
    const t = setTimeout(() => {
      void ensurePanel();
    }, 5000);
    return () => clearTimeout(t);
  }, 'dsh-pet-plus: panel autostart');

  ctx.effect(() => ctx.on('session/event', onSessionEvent), 'dsh-pet-plus: todo progress');

  ctx.effect(() => {
    const warm = setTimeout(sampleCpu, 800);
    const first = setTimeout(tick, 6000);
    const timer = setInterval(tick, MIN);
    return () => {
      clearTimeout(warm);
      clearTimeout(first);
      clearInterval(timer);
    };
  }, 'dsh-pet-plus: tick');

  ctx.effect(() => () => saveNow(), 'dsh-pet-plus: save on unload');
}
