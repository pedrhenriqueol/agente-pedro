import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';

// Exercise the real stores/database/bridge in separate JavaScript worlds, like two WebViews.
const bundle = await build({
  stdin: {
    contents: `export { useFocusStore } from './src/stores/useFocusStore';
      export { useFinanceStore, formatCentsToBRL } from './src/stores/useFinanceStore';
      export * from './src/services/stateBridge';`,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"test"' },
});
const compiled = bundle.outputFiles[0].text;
const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function environment({ broadcast = true, native = false, storageEvents = true } = {}) {
  const storage = new Map();
  const worlds = [];
  const ports = new Set();
  const writes = [];
  const nativeListeners = new Map();
  const clock = { now: new Date(2026, 9, 12, 12).getTime() };
  let failDatabaseWrites = false;
  let pendingWrites = null;
  let lock = Promise.resolve();
  class ClockDate extends Date {
    constructor(...args) { if (args.length === 0) super(clock.now); else super(...args); }
    static now() { return clock.now; }
  }

  function page() {
    const listeners = new Map();
    const intervals = new Map();
    const world = { listeners, intervals };
    worlds.push(world);
    const window = {
      addEventListener(name, callback) {
        const entries = listeners.get(name) ?? new Set();
        entries.add(callback); listeners.set(name, entries);
      },
      removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
      setInterval(callback) { const id = intervals.size + 1; intervals.set(id, callback); return id; },
      clearInterval(id) { intervals.delete(id); },
    };
    const localStorage = {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) {
        if (failDatabaseWrites && key === 'agente_pedro_local_db') throw new Error('Disco indisponível');
        const oldValue = storage.get(key) ?? null;
        storage.set(key, value); writes.push(key);
        if (oldValue === value || !storageEvents) return;
        for (const other of worlds) {
          if (other === world) continue;
          queueMicrotask(() => other.listeners.get('storage')?.forEach((callback) => callback({ key, oldValue, newValue: value })));
        }
      },
    };
    class Channel {
      constructor(name) { this.name = name; this.onmessage = null; ports.add(this); }
      postMessage(data) {
        for (const other of ports) {
          if (other !== this && other.name === this.name) queueMicrotask(() => other.onmessage?.({ data }));
        }
      }
      close() { ports.delete(this); }
    }
    const module = { exports: {} };
    if (native) {
      const callbacks = new Map();
      let nextCallback = 0;
      window.__TAURI_INTERNALS__ = {
        transformCallback(callback) { const id = ++nextCallback; callbacks.set(id, callback); return id; },
        async invoke(command, args) {
          if (command === 'plugin:event|listen') {
            const id = randomUUID(); nativeListeners.set(id, { event: args.event, callback: callbacks.get(args.handler) }); return id;
          }
          if (command === 'plugin:event|emit') {
            for (const [id, listener] of nativeListeners) {
              if (listener.event === args.event) queueMicrotask(() => listener.callback({ event: args.event, id, payload: args.payload }));
            }
            return;
          }
          if (command === 'plugin:event|unlisten') { nativeListeners.delete(args.eventId); return; }
          throw new Error(`Runtime SQL não faz parte deste teste de transporte: ${command}`);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, id) { nativeListeners.delete(id); } };
    }
    const sandbox = {
      module, exports: module.exports, window, localStorage, Date: ClockDate,
      console: { ...console, error() {}, warn() {} }, crypto: { randomUUID },
      navigator: { locks: { request(_name, callback) {
        const result = lock.then(async () => { if (pendingWrites) await pendingWrites; return callback(); });
        lock = result.catch(() => {}); return result;
      } } },
      setTimeout, clearTimeout, queueMicrotask,
      ...(broadcast ? { BroadcastChannel: Channel } : {}),
    };
    vm.runInNewContext(compiled, sandbox);
    return { ...module.exports, intervals, listeners };
  }

  return { page, clock, storage, writes, ports, nativeListeners,
    failWrites(value) { failDatabaseWrites = value; },
    holdWrites() {
      let release;
      pendingWrites = new Promise((resolve) => { release = resolve; });
      return () => { pendingWrites = null; release(); };
    },
    close() { worlds.forEach((world) => world.intervals.clear()); ports.forEach((port) => port.close()); },
  };
}

test('Timer sincroniza comandos entre janelas e nunca publica os ticks', async () => {
  const env = environment();
  const main = env.page(); const island = env.page();
  const closeMain = await main.initializeStateBridge(); const closeIsland = await island.initializeStateBridge();
  try {
    await Promise.all([main.useFocusStore.getState().loadInitialData(), island.useFocusStore.getState().loadInitialData()]);
    main.useFocusStore.getState().setPomodoroMode('break'); await settle();
    assert.equal(island.useFocusStore.getState().remainingSeconds, 300);
    assert.equal(island.useFocusStore.getState().pomodoroState, 'idle');
    main.useFocusStore.getState().startPomodoro('focus'); await settle();
    const sessionId = main.useFocusStore.getState().sessionId;
    assert.equal(island.useFocusStore.getState().sessionId, sessionId);
    assert.equal(island.useFocusStore.getState().targetTimestamp, main.useFocusStore.getState().targetTimestamp);
    const sent = env.writes.filter((key) => key === 'agente_pedro_state_event_v1').length;
    env.clock.now += 10_000;
    main.useFocusStore.getState().tickTimer(); island.useFocusStore.getState().tickTimer(); await settle();
    assert.equal(main.useFocusStore.getState().remainingSeconds, 1490);
    assert.equal(island.useFocusStore.getState().remainingSeconds, 1490);
    assert.equal(env.writes.filter((key) => key === 'agente_pedro_state_event_v1').length, sent);
    island.useFocusStore.getState().pausePomodoro(); await settle();
    assert.equal(main.useFocusStore.getState().pomodoroState, 'paused');
    env.clock.now += 15_000;
    main.useFocusStore.getState().resumePomodoro(); await settle();
    assert.equal(island.useFocusStore.getState().remainingSeconds, 1490);
    assert.equal(island.useFocusStore.getState().sessionId, sessionId);
    assert.equal(main.intervals.size, 1); assert.equal(island.intervals.size, 1);
    island.useFocusStore.getState().resetPomodoro(); await settle();
    assert.equal(main.useFocusStore.getState().remainingSeconds, 1500);
    assert.equal(main.intervals.size, 0); assert.equal(island.intervals.size, 0);
  } finally { closeMain(); closeIsland(); env.close(); }
});

test('Conclusão concorrente salva uma sessão por ID; pausas não viram foco', async () => {
  const env = environment(); const main = env.page(); const island = env.page();
  const closeMain = await main.initializeStateBridge(); const closeIsland = await island.initializeStateBridge();
  try {
    await Promise.all([main.useFocusStore.getState().loadInitialData(), island.useFocusStore.getState().loadInitialData()]);
    main.useFocusStore.getState().startPomodoro('focus'); await settle();
    env.clock.now += 1_500_000;
    main.useFocusStore.getState().tickTimer(); island.useFocusStore.getState().tickTimer(); await settle();
    const saved = JSON.parse(env.storage.get('agente_pedro_local_db'));
    assert.equal(saved.pomodoro_sessions.length, 1);
    assert.equal(main.useFocusStore.getState().sessionSaveState, 'saved');
    assert.equal(island.useFocusStore.getState().sessions.length, 1);
    island.useFocusStore.getState().startPomodoro('break'); await settle();
    env.clock.now += 300_000;
    main.useFocusStore.getState().tickTimer(); island.useFocusStore.getState().tickTimer(); await settle();
    assert.equal(JSON.parse(env.storage.get('agente_pedro_local_db')).pomodoro_sessions.length, 1);
  } finally { closeMain(); closeIsland(); env.close(); }
});

test('Rotina e finanças aparecem na outra janela depois de gravações reais', async () => {
  const env = environment(); const main = env.page(); const island = env.page();
  const closeMain = await main.initializeStateBridge(); const closeIsland = await island.initializeStateBridge();
  try {
    await Promise.all([main.useFocusStore.getState().loadInitialData(), main.useFinanceStore.getState().loadFinancialData(),
      island.useFocusStore.getState().loadInitialData(), island.useFinanceStore.getState().loadFinancialData()]);
    await main.useFocusStore.getState().addTask('Preparar revisão', 'high'); await settle();
    const task = island.useFocusStore.getState().tasks[0];
    assert.equal(task.title, 'Preparar revisão'); assert.equal(task.completed, 0);
    main.useFocusStore.getState().selectTask(task.id); await settle();
    assert.equal(island.useFocusStore.getState().selectedTaskId, task.id);
    await island.useFocusStore.getState().toggleTask(task.id, 0); await settle();
    assert.equal(main.useFocusStore.getState().tasks[0].completed, 1);
    await main.useFocusStore.getState().addHabit('Ler'); await main.useFocusStore.getState().addHabit('Caminhar'); await settle();
    const habit = island.useFocusStore.getState().habits.find((item) => item.name === 'Caminhar');
    await island.useFocusStore.getState().completeHabit(habit.id); await settle();
    assert.equal(main.useFocusStore.getState().habits.find((item) => item.name === 'Ler').streak_count, 0);
    assert.equal(main.useFocusStore.getState().habits.find((item) => item.id === habit.id).streak_count, 1);
    await main.useFinanceStore.getState().addAccount('Carteira', 'wallet', 5000); await settle();
    const account = island.useFinanceStore.getState().accounts[0];
    await island.useFinanceStore.getState().addTransaction({ account_id: account.id, description: 'Almoço', amount_cents: 1050, type: 'expense', category: 'Alimentação' });
    await island.useFinanceStore.getState().setBudget('Alimentação', 30_000); await settle();
    assert.equal(main.useFinanceStore.getState().accounts[0].balance_cents, 3950);
    assert.equal(main.useFinanceStore.getState().consolidated.monthly_expense_cents, 1050);
    assert.equal(main.useFinanceStore.getState().budgets[0].limit_cents, 30_000);
    await island.useFocusStore.getState().removeTask(task.id); await settle();
    assert.equal(main.useFocusStore.getState().tasks.length, 0);
    assert.equal(main.useFocusStore.getState().selectedTaskId, null);
    assert.equal(main.formatCentsToBRL(-25000), '-R$ 250,00');
  } finally { closeMain(); closeIsland(); env.close(); }
});

test('Falhas de gravação rejeitam a ação, preservam estado e permitem nova tentativa', async () => {
  const env = environment(); const page = env.page();
  try {
    await Promise.all([page.useFocusStore.getState().loadInitialData(), page.useFinanceStore.getState().loadFinancialData()]);
    env.failWrites(true);
    await assert.rejects(page.useFocusStore.getState().addTask('Não apagar o texto', 'high'));
    assert.equal(page.useFocusStore.getState().tasks.length, 0);
    assert.match(page.useFocusStore.getState().error, /Não foi possível/);
    await assert.rejects(page.useFinanceStore.getState().addAccount('Não apagar o nome', 'wallet', 5000));
    assert.equal(page.useFinanceStore.getState().accounts.length, 0);
    assert.match(page.useFinanceStore.getState().error, /Não foi possível/);
    env.failWrites(false);
    await page.useFocusStore.getState().addTask('Não apagar o texto', 'high');
    await page.useFinanceStore.getState().addAccount('Não apagar o nome', 'wallet', 5000);
    assert.equal(page.useFocusStore.getState().error, null); assert.equal(page.useFinanceStore.getState().error, null);
    assert.equal(page.useFocusStore.getState().tasks.length, 1); assert.equal(page.useFinanceStore.getState().accounts.length, 1);
  } finally { env.close(); }
});

test('Storage funciona sem BroadcastChannel e limpeza StrictMode mantém um transporte', async () => {
  const env = environment({ broadcast: false }); const main = env.page(); const island = env.page();
  const [closeFirst, closeSecond] = await Promise.all([main.initializeStateBridge(), main.initializeStateBridge()]);
  const closeIsland = await island.initializeStateBridge();
  try {
    assert.equal(main.listeners.get('storage').size, 1);
    closeFirst(); assert.equal(main.listeners.get('storage').size, 1);
    island.useFocusStore.getState().setPomodoroMode('break'); await settle();
    assert.equal(main.useFocusStore.getState().remainingSeconds, 300);
    const before = env.writes.length; await settle(); assert.equal(env.writes.length, before, 'Nenhum eco depois de estabilizar');
    closeSecond(); assert.equal(main.listeners.get('storage').size, 0);
    const closeRestart = await main.initializeStateBridge();
    assert.equal(main.listeners.get('storage').size, 1); closeRestart();
    assert.equal(main.listeners.get('storage').size, 0);
  } finally { closeFirst(); closeSecond(); closeIsland(); env.close(); }
});

test('Uma janela nova recupera o prazo real e snapshots antigos não reiniciam o timer', async () => {
  const env = environment(); const first = env.page();
  const closeFirst = await first.initializeStateBridge();
  let closeSecond;
  try {
    first.useFocusStore.getState().startPomodoro('focus'); await settle();
    const started = JSON.parse(env.storage.get('agente_pedro_timer_v1'));
    env.clock.now += 42_000;
    const reopened = env.page(); closeSecond = await reopened.initializeStateBridge(); await settle();
    assert.equal(reopened.useFocusStore.getState().remainingSeconds, 1458);
    assert.equal(reopened.useFocusStore.getState().sessionId, started.sessionId);
    reopened.useFocusStore.getState().pausePomodoro(); await settle();
    await first.publishStateEvent('timer:snapshot', started); await settle();
    assert.equal(reopened.useFocusStore.getState().pomodoroState, 'paused');
    assert.equal(first.useFocusStore.getState().pomodoroState, 'paused');
    await first.publishStateEvent('timer:snapshot', { ...started, remainingSeconds: -2 }); await settle();
    assert.equal(reopened.useFocusStore.getState().remainingSeconds, 1458);
  } finally { closeFirst(); closeSecond?.(); env.close(); }
});

test('O transporte nativo usa listen/emit oficiais sem depender de eventos do navegador', async () => {
  const env = environment({ native: true, broadcast: false, storageEvents: false });
  const main = env.page(); const island = env.page();
  const closeMain = await main.initializeStateBridge(); const closeIsland = await island.initializeStateBridge();
  try {
    assert.equal(env.nativeListeners.size, 2);
    main.useFocusStore.getState().startPomodoro('focus'); await settle();
    assert.equal(island.useFocusStore.getState().sessionId, main.useFocusStore.getState().sessionId);
    island.useFocusStore.getState().pausePomodoro(); await settle();
    assert.equal(main.useFocusStore.getState().pomodoroState, 'paused');
    assert.equal(env.ports.size, 0);
  } finally {
    closeMain(); closeIsland(); env.close();
    assert.equal(env.nativeListeners.size, 0);
  }
});

test('Um comando consulta o snapshot recente antes de receber o evento atrasado', async () => {
  const env = environment(); const main = env.page(); const island = env.page();
  const closeMain = await main.initializeStateBridge(); const closeIsland = await island.initializeStateBridge();
  try {
    main.useFocusStore.getState().startPomodoro('focus');
    // Deliberately pause before queued storage/BroadcastChannel callbacks are delivered.
    island.useFocusStore.getState().pausePomodoro(); await settle();
    assert.equal(main.useFocusStore.getState().pomodoroState, 'paused');
    assert.equal(island.useFocusStore.getState().pomodoroState, 'paused');
    assert.equal(main.useFocusStore.getState().sessionId, island.useFocusStore.getState().sessionId);
  } finally { closeMain(); closeIsland(); env.close(); }
});

test('Um tick atrasado respeita a pausa, o reset e a nova sessão da outra janela', async () => {
  for (const command of ['pausePomodoro', 'resetPomodoro', 'startPomodoro']) {
    const env = environment(); const main = env.page(); const island = env.page();
    const closeMain = await main.initializeStateBridge(); const closeIsland = await island.initializeStateBridge();
    try {
      main.useFocusStore.getState().startPomodoro('focus'); await settle();
      env.clock.now += 1_499_000;
      if (command === 'startPomodoro') island.useFocusStore.getState().startPomodoro('break');
      else island.useFocusStore.getState()[command]();
      const fresh = island.useFocusStore.getState();
      const expected = { state: fresh.pomodoroState, sessionId: fresh.sessionId, targetTimestamp: fresh.targetTimestamp };
      // The main window still has the old deadline when its next interval callback runs.
      env.clock.now += 2_000;
      main.useFocusStore.getState().tickTimer(); await settle();
      for (const page of [main, island]) {
        const current = page.useFocusStore.getState();
        assert.equal(current.pomodoroState, expected.state, command);
        assert.equal(current.sessionId, expected.sessionId, command);
        assert.equal(current.targetTimestamp, expected.targetTimestamp, command);
        assert.equal(current.sessions.length, 0, 'A sessão antiga não pode ser registrada após outro comando');
      }
      if (command === 'pausePomodoro') assert.equal(main.useFocusStore.getState().remainingSeconds, 1);
      if (command === 'resetPomodoro') assert.equal(main.useFocusStore.getState().remainingSeconds, 1500);
      if (command === 'startPomodoro') assert.equal(main.useFocusStore.getState().remainingSeconds, 298);
    } finally { closeMain(); closeIsland(); env.close(); }
  }
});

test('Uma sessão vencida durante o app fechado guarda o dia do deadline, sem duplicar na reabertura', async () => {
  const env = environment();
  env.clock.now = new Date(2026, 9, 12, 23).getTime();
  const first = env.page(); const closeFirst = await first.initializeStateBridge();
  first.useFocusStore.getState().startPomodoro('focus'); await settle();
  const started = JSON.parse(env.storage.get('agente_pedro_timer_v1'));
  // Upgrade from a v1 snapshot that predates completedAt must preserve the known deadline.
  delete started.completedAt;
  env.storage.set('agente_pedro_timer_v1', JSON.stringify(started));
  closeFirst(); first.intervals.clear();
  env.clock.now = new Date(2026, 9, 13, 9).getTime();
  const reopened = env.page(); const island = env.page();
  const closeReopened = await reopened.initializeStateBridge(); const closeIsland = await island.initializeStateBridge();
  try {
    await Promise.all([reopened.useFocusStore.getState().loadInitialData(), island.useFocusStore.getState().loadInitialData()]);
    await settle();
    const sessions = JSON.parse(env.storage.get('agente_pedro_local_db')).pomodoro_sessions;
    const deadline = new Date(started.targetTimestamp).toISOString();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].completed_at, deadline);
    assert.equal(reopened.useFocusStore.getState().completedAt, deadline);
    assert.equal(island.useFocusStore.getState().completedAt, deadline);
    assert.equal(new Date(sessions[0].completed_at).getDate(), 12);
    assert.notEqual(sessions[0].completed_at, new Date(env.clock.now).toISOString());
  } finally { closeReopened(); closeIsland(); env.close(); }
});

test('Comandos do timer preservam a sessão em gravação e a falha continua recuperável', async () => {
  const env = environment(); const main = env.page(); const island = env.page();
  const closeMain = await main.initializeStateBridge(); const closeIsland = await island.initializeStateBridge();
  let release;
  try {
    await Promise.all([main.useFocusStore.getState().loadInitialData(), island.useFocusStore.getState().loadInitialData()]);
    main.useFocusStore.getState().selectTask('tarefa-em-foco');
    main.useFocusStore.getState().startPomodoro('focus'); await settle();
    const sessionId = main.useFocusStore.getState().sessionId;
    const deadline = new Date(main.useFocusStore.getState().targetTimestamp).toISOString();
    release = env.holdWrites(); env.failWrites(true);
    env.clock.now += 1_500_000;
    main.useFocusStore.getState().tickTimer();
    assert.equal(main.useFocusStore.getState().sessionSaveState, 'saving');
    for (const page of [main, island]) {
      // The island has not received the completion event yet. Each command must hydrate first.
      page.useFocusStore.getState().resetPomodoro();
      page.useFocusStore.getState().startPomodoro('break');
      page.useFocusStore.getState().setPomodoroMode('break');
      page.useFocusStore.getState().selectTask(null);
      assert.equal(page.useFocusStore.getState().sessionId, sessionId);
      assert.equal(page.useFocusStore.getState().currentMode, 'focus');
      assert.equal(page.useFocusStore.getState().pomodoroState, 'completed');
      assert.equal(page.useFocusStore.getState().selectedTaskId, 'tarefa-em-foco');
      assert.equal(page.useFocusStore.getState().sessionSaveState, 'saving');
    }
    release(); release = null; await settle();
    for (const page of [main, island]) {
      assert.equal(page.useFocusStore.getState().sessionSaveState, 'error');
      assert.match(page.useFocusStore.getState().error, /não foi possível salvar/);
      page.useFocusStore.getState().resetPomodoro();
      page.useFocusStore.getState().startPomodoro('break');
      page.useFocusStore.getState().setPomodoroMode('break');
      page.useFocusStore.getState().selectTask(null);
      assert.equal(page.useFocusStore.getState().sessionId, sessionId);
      assert.equal(page.useFocusStore.getState().completedAt, deadline);
      assert.equal(page.useFocusStore.getState().currentMode, 'focus');
      assert.equal(page.useFocusStore.getState().pomodoroState, 'completed');
      assert.equal(page.useFocusStore.getState().selectedTaskId, 'tarefa-em-foco');
      assert.equal(page.useFocusStore.getState().sessionSaveState, 'error');
    }
    env.failWrites(false);
    await Promise.all([main.useFocusStore.getState().refreshData(), island.useFocusStore.getState().refreshData()]); await settle();
    const sessions = JSON.parse(env.storage.get('agente_pedro_local_db')).pomodoro_sessions;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, sessionId);
    assert.equal(sessions[0].completed_at, deadline);
    assert.equal(main.useFocusStore.getState().sessionSaveState, 'saved');
    assert.equal(island.useFocusStore.getState().sessionSaveState, 'saved');
    main.useFocusStore.getState().startPomodoro('break'); await settle();
    assert.notEqual(main.useFocusStore.getState().sessionId, sessionId);
    assert.equal(main.useFocusStore.getState().currentMode, 'break');
    assert.equal(island.useFocusStore.getState().currentMode, 'break');
    assert.equal(JSON.parse(env.storage.get('agente_pedro_local_db')).pomodoro_sessions.length, 1);
  } finally { release?.(); closeMain(); closeIsland(); env.close(); }
});
