#!/usr/bin/env node
/**
 * dsh-pet-plus 的独立命令行入口：不启动 DSH，直接驱动正在运行的桌宠。
 *
 * 用途：
 *   - 还没重启 DSH（插件尚未加载）时先体验功能
 *   - 调试 dsh-pet 的 /broadcast、/anim 接口
 *
 * 用法：
 *   node standalone.js --port 64679 [--pet main] [--surface any]
 *   然后输入 feed / status / stats / focus 25 / water 45 / progress 3/7 文案 / quit
 *
 * 端口就是 DSH 页面地址的端口（GUI 右上角地址栏，通常是 64679）。
 */
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const port = Number(arg('--port', process.env.DSH_PET_PLUS_PORT || '64679'));
if (!Number.isFinite(port) || port <= 0) {
  console.error('端口不合法，用 --port <DSH 端口> 指定');
  process.exit(1);
}
if (arg('--pet')) process.env.DSH_PET_PLUS_ID = arg('--pet');
if (arg('--surface')) process.env.DSH_PET_PLUS_SURFACE = arg('--surface');

const { apply } = await import('./index.js');

const commands = new Map();
const ctx = {
  webServer: { port },
  commands: {
    register(spec) {
      commands.set(spec.name, spec);
      return () => commands.delete(spec.name);
    },
  },
  on() {
    return () => {};
  },
  effect(fn) {
    fn();
    return () => {};
  },
};

apply(ctx);

console.log('dsh-pet-plus 独立模式：端口 ' + port + '，宠物 ' + (process.env.DSH_PET_PLUS_ID || 'main'));
console.log('可用：feed / status / stats / focus 25 / focus stop / water 45 / water off');
console.log('      progress 3/7 写插件 / help / quit');
console.log('（任务进度自动气泡需要 DSH 宿主里的 todo 事件，独立模式只能用 /progress 手动触发）');

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '小女仆> ' });

const alias = { status: 'petstatus', feed: 'feed', stats: 'stats', focus: 'focus', water: 'water', progress: 'progress' };

async function run(text) {
  const name = text.split(/\s+/)[0].toLowerCase();
  const raw = text.slice(name.length).trim();
  if (name === 'help' || name === '?') {
    console.log('feed / status / stats / focus <分钟|stop> / water <分钟|off> / progress <完成/总数 文案> / quit');
    return;
  }
  const spec = commands.get(alias[name] || name);
  if (!spec) {
    console.log('不认识的命令：' + name);
    return;
  }
  const result = await spec.handler({ rawInput: raw });
  console.log((result && result.text) || '（无回执）');
}

const exec = arg('--exec', '');
if (exec) {
  await run(exec);
  // 给 HTTP 请求一点收尾时间
  setTimeout(() => process.exit(0), 800);
} else {
  rl.prompt();
  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }
    if (/^(quit|exit|q)$/i.test(text)) {
      rl.close();
      return;
    }
    try {
      await run(text);
    } catch (e) {
      console.error('执行失败：' + (e instanceof Error ? e.message : String(e)));
    }
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}
