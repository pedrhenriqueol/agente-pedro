import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

// Keep the store and client real; substitute only the Windows/Tauri IPC boundary.
const bundle = await build({
  stdin: {
    contents: `export * from './src/stores/useMediaStore';
      export * from './src/services/mediaClient';`,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{
    name: 'media-ipc-boundary',
    setup(builder) {
      builder.onResolve({ filter: /^@tauri-apps\/api\/(core|event)$/ }, ({ path }) => ({ path, namespace: 'media-ipc' }));
      builder.onLoad({ filter: /./, namespace: 'media-ipc' }, ({ path }) => ({
        contents: path.endsWith('/core')
          ? `export const isTauri = () => globalThis.mediaIpc.native;
             export const invoke = (command, args) => globalThis.mediaIpc.invoke(command, args);`
          : `export const listen = (event, callback) => globalThis.mediaIpc.listen(event, callback);`,
        loader: 'js',
      }));
    },
  }],
});
const compiled = bundle.outputFiles[0].text;
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
function deferred() {
  let resolve; let reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

function snapshot({ revision = 1, sequence = revision, session = {}, ...overrides } = {}) {
  return {
    revision, sequence, supported: true, volume: 50, muted: false, error: null,
    session: session === null ? null : {
      id: 'soundcloud-tab', sourceApp: 'chrome.exe', title: 'Faixa atual', artist: 'Artista', album: '',
      artwork: 'data:image/png;base64,Y292ZXI=', playbackStatus: 'playing',
      canPlay: true, canPause: true, canGoNext: true, canGoPrevious: false,
      positionSeconds: 12, durationSeconds: 180, ...session,
    },
    ...overrides,
  };
}

function environment({ native = true, initial = snapshot() } = {}) {
  const calls = []; const trace = []; const listeners = new Map();
  const removed = []; const timers = new Map();
  let timerSequence = 0;
  const clock = {
    now: 10_000,
    advance(milliseconds) {
      const target = this.now + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); this.now = next[1].at; next[1].callback();
      }
      this.now = target;
    },
  };
  let sequence = 0; let rejectedEvent = null;
  let invoke = async (command) => {
    if (command === 'media_snapshot' || command === 'media_control') return initial;
    throw new Error(`IPC inesperado: ${command}`);
  };
  class ClockDate extends Date {
    static now() { return clock.now; }
  }
  const mediaIpc = {
    native,
    async invoke(command, args) {
      trace.push(`invoke:${command}`); calls.push({ command, args });
      return invoke(command, args);
    },
    async listen(event, callback) {
      trace.push(`listen:${event}`);
      if (event === rejectedEvent) throw new Error('Listener indisponível');
      const id = ++sequence; listeners.set(id, { event, callback });
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true; removed.push(id); listeners.delete(id);
      };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, mediaIpc, Date: ClockDate, Error, console,
    setTimeout(callback, delay) {
      const id = ++timerSequence;
      timers.set(id, { callback, at: clock.now + delay }); return id;
    },
    clearTimeout(id) { timers.delete(id); },
    queueMicrotask,
  });
  return {
    ...module.exports, calls, trace, listeners, removed, clock, timers,
    handleInvoke(handler) { invoke = handler; },
    rejectListen(event) { rejectedEvent = event; },
    emit(event, payload) {
      for (const listener of listeners.values()) {
        if (listener.event === event) listener.callback({ event, payload });
      }
    },
  };
}

test('Navegador informa integração indisponível sem inventar sessão ou acessar IPC nativo', async () => {
  const env = environment({ native: false });
  const close = await env.initializeMedia();
  try {
    const state = env.useMediaStore.getState();
    assert.equal(state.initialized, true);
    assert.deepEqual(plain(state.snapshot), plain(env.EMPTY_MEDIA));
    assert.equal(state.snapshot.session, null);
    await assert.rejects(state.controlMedia('play'), /Windows/);
    await assert.rejects(env.sendMediaControl('volume', null, 60), /Windows/);
    assert.equal(env.calls.length, 0);
    assert.equal(env.listeners.size, 0);
  } finally { close(); close(); }
});

test('Montagens concorrentes e remonte StrictMode compartilham listeners e limpam a última referência', async () => {
  const env = environment();
  const [closeFirst, closeSecond] = await Promise.all([env.initializeMedia(), env.initializeMedia()]);
  try {
    assert.deepEqual(env.trace, ['listen:pedro:media', 'listen:pedro:media-position', 'invoke:media_snapshot']);
    assert.equal(env.listeners.size, 2);
    closeFirst(); closeFirst();
    assert.equal(env.listeners.size, 2, 'Uma limpeza repetida não remove a assinatura da outra montagem');
    env.emit('pedro:media', snapshot({ revision: 2, session: { title: 'Próxima faixa' } }));
    assert.equal(env.useMediaStore.getState().snapshot.session.title, 'Próxima faixa');
    closeSecond();
    assert.equal(env.listeners.size, 0);
    assert.equal(env.removed.length, 2);
    const closeRestart = await env.initializeMedia();
    try {
      assert.equal(env.listeners.size, 2);
      assert.equal(env.calls.filter(({ command }) => command === 'media_snapshot').length, 2);
    } finally { closeRestart(); }
    assert.equal(env.listeners.size, 0);
    assert.equal(env.removed.length, 4);
  } finally { closeFirst(); closeSecond(); }
});

test('Resposta inicial atrasada não substitui a faixa recebida por evento mais recente', async () => {
  const env = environment(); const initialRead = deferred();
  env.handleInvoke(() => initialRead.promise);
  const initializing = env.initializeMedia();
  await settle();
  assert.equal(env.listeners.size, 2, 'O listener deve existir antes de consultar o snapshot');
  env.emit('pedro:media', snapshot({ revision: 8, session: { id: 'new-session', title: 'Faixa nova' } }));
  initialRead.resolve(snapshot({ revision: 7, session: { title: 'Faixa antiga' } }));
  const close = await initializing;
  try {
    assert.equal(env.useMediaStore.getState().snapshot.revision, 8);
    assert.equal(env.useMediaStore.getState().snapshot.session.title, 'Faixa nova');
    env.emit('pedro:media', snapshot({ revision: 6, session: null }));
    assert.equal(env.useMediaStore.getState().snapshot.session.id, 'new-session');
  } finally { close(); }
});

test('Resposta inicial com a mesma revisão não retrocede a posição recebida em sequência mais recente', async () => {
  const env = environment(); const initialRead = deferred();
  env.handleInvoke(() => initialRead.promise);
  const initializing = env.initializeMedia();
  await settle();
  env.emit('pedro:media', snapshot({ revision: 4, sequence: 20 }));
  env.emit('pedro:media-position', { revision: 4, sequence: 21, sessionId: 'soundcloud-tab', positionSeconds: 18, durationSeconds: 180 });
  initialRead.resolve(snapshot({ revision: 4, sequence: 20, session: { positionSeconds: 12 } }));
  const close = await initializing;
  try {
    assert.equal(env.useMediaStore.getState().snapshot.sequence, 21);
    assert.equal(env.useMediaStore.getState().snapshot.session.positionSeconds, 18);
    env.emit('pedro:media', snapshot({ revision: 4, sequence: 19, session: { positionSeconds: 10 } }));
    assert.equal(env.useMediaStore.getState().snapshot.session.positionSeconds, 18);
  } finally { close(); }
});

test('Ticks leves de posição exigem revisão e sessão atuais e uma sequência atual ou mais recente', async () => {
  const env = environment({ initial: snapshot({ revision: 4, sequence: 20 }) });
  const close = await env.initializeMedia();
  try {
    const before = plain(env.useMediaStore.getState().snapshot);
    const observedBefore = env.useMediaStore.getState().observedAt;
    env.clock.now += 1_000;
    env.emit('pedro:media-position', { revision: 3, sequence: 21, sessionId: 'soundcloud-tab', positionSeconds: 90, durationSeconds: 200 });
    env.emit('pedro:media-position', { revision: 4, sequence: 21, sessionId: 'closed-tab', positionSeconds: 90, durationSeconds: 200 });
    env.emit('pedro:media-position', { revision: 4, sequence: 19, sessionId: 'soundcloud-tab', positionSeconds: 10, durationSeconds: 180 });
    assert.deepEqual(plain(env.useMediaStore.getState().snapshot), before);
    assert.equal(env.useMediaStore.getState().observedAt, observedBefore);
    env.emit('pedro:media-position', { revision: 4, sequence: 21, sessionId: 'soundcloud-tab', positionSeconds: 17, durationSeconds: 182 });
    const current = env.useMediaStore.getState();
    assert.equal(current.snapshot.session.positionSeconds, 17);
    assert.equal(current.snapshot.session.durationSeconds, 182);
    assert.equal(current.snapshot.session.artwork, before.session.artwork);
    assert.equal(current.snapshot.session.title, before.session.title);
    assert.equal(current.snapshot.revision, 4);
    assert.equal(current.snapshot.sequence, 21);
    assert.equal(current.observedAt, env.clock.now);
    env.emit('pedro:media-position', { revision: 4, sequence: 21, sessionId: 'soundcloud-tab', positionSeconds: 18, durationSeconds: 182 });
    assert.equal(env.useMediaStore.getState().snapshot.session.positionSeconds, 18, 'Uma sequência igual ainda pertence ao estado atual');
    env.emit('pedro:media', snapshot({ revision: 5, session: null }));
    env.emit('pedro:media-position', { revision: 5, sequence: 6, sessionId: 'soundcloud-tab', positionSeconds: 20, durationSeconds: 182 });
    assert.equal(env.useMediaStore.getState().snapshot.session, null);
  } finally { close(); }
});

test('Cliente envia o contrato camelCase com a sessão alvo e normaliza valor ausente para null', async () => {
  const env = environment();
  const result = await env.sendMediaControl('pause', 'soundcloud-tab');
  assert.deepEqual(plain(result), snapshot());
  await env.sendMediaControl('volume', null, 73);
  assert.deepEqual(plain(env.calls), [
    { command: 'media_control', args: { action: 'pause', sessionId: 'soundcloud-tab', value: null } },
    { command: 'media_control', args: { action: 'volume', sessionId: null, value: 73 } },
  ]);
});

test('Transporte pendente bloqueia cliques repetidos, mas alterações de volume preservam o último valor', async () => {
  const env = environment(); const close = await env.initializeMedia();
  const commands = [];
  env.handleInvoke((command, args) => {
    assert.equal(command, 'media_control');
    const response = deferred(); commands.push({ args, ...response }); return response.promise;
  });
  try {
    const pause = env.useMediaStore.getState().controlMedia('pause');
    await env.useMediaStore.getState().controlMedia('next');
    const firstVolume = env.useMediaStore.getState().controlMedia('volume', 13);
    const lastVolume = env.useMediaStore.getState().controlMedia('volume', 78);
    await settle();
    assert.equal(commands.length, 1);
    assert.deepEqual(plain(commands[0].args), { action: 'pause', sessionId: 'soundcloud-tab', value: null });
    assert.equal(env.useMediaStore.getState().pending, true);
    commands[0].resolve(snapshot({ revision: 2, session: { playbackStatus: 'paused' } }));
    await pause; await settle();
    assert.equal(commands.length, 2);
    assert.equal(commands[1].args.value, 13);
    assert.equal(env.useMediaStore.getState().pending, true);
    commands[1].resolve(snapshot({ revision: 3, volume: 13, session: { playbackStatus: 'paused' } }));
    await firstVolume; await settle();
    assert.equal(commands.length, 3);
    assert.equal(commands[2].args.value, 78);
    assert.equal(env.useMediaStore.getState().pending, true);
    commands[2].resolve(snapshot({ revision: 4, volume: 78, session: { playbackStatus: 'paused' } }));
    await lastVolume;
    assert.deepEqual(commands.map(({ args }) => args.action), ['pause', 'volume', 'volume']);
    assert.equal(env.useMediaStore.getState().snapshot.volume, 78);
    assert.equal(env.useMediaStore.getState().pending, false);
  } finally { close(); }
});

test('Falha do controle preserva faixa, mostra erro e libera a fila para nova tentativa', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    const original = plain(env.useMediaStore.getState().snapshot);
    env.handleInvoke(async () => { throw new Error('O navegador encerrou a sessão'); });
    await assert.rejects(env.useMediaStore.getState().controlMedia('pause'), /encerrou a sessão/);
    assert.deepEqual(plain(env.useMediaStore.getState().snapshot), original);
    assert.equal(env.useMediaStore.getState().pending, false);
    assert.match(env.useMediaStore.getState().error, /encerrou a sessão/);
    env.handleInvoke(async () => snapshot({ revision: 2, session: { playbackStatus: 'paused' } }));
    await env.useMediaStore.getState().controlMedia('pause');
    assert.equal(env.useMediaStore.getState().snapshot.session.playbackStatus, 'paused');
    assert.equal(env.useMediaStore.getState().error, null);
    assert.equal(env.useMediaStore.getState().pending, false);
  } finally { close(); }
});

test('Volume funciona sem sessão, rejeita entradas inválidas e não envia transporte sem faixa', async () => {
  const env = environment({ initial: snapshot({ session: null }) });
  const close = await env.initializeMedia();
  try {
    for (const invalid of [-1, 101, NaN, Infinity, undefined]) {
      await assert.rejects(env.useMediaStore.getState().controlMedia('volume', invalid), /entre 0 e 100/);
    }
    await assert.rejects(env.useMediaStore.getState().controlMedia('play'), /Nenhuma reprodução/);
    assert.equal(env.calls.length, 1, 'Valores inválidos e transporte vazio não chegam ao backend');
    await env.useMediaStore.getState().controlMedia('volume', 0);
    assert.deepEqual(plain(env.calls[1]), { command: 'media_control', args: { action: 'volume', sessionId: null, value: 0 } });
    assert.equal(env.useMediaStore.getState().pending, false);
  } finally { close(); }
});

test('Ações indisponíveis no player falham antes do IPC e explicam o erro sem alterar a faixa', async () => {
  for (const [action, capability] of [['play', 'canPlay'], ['pause', 'canPause'], ['next', 'canGoNext'], ['previous', 'canGoPrevious']]) {
    const env = environment({ initial: snapshot({ session: { [capability]: false } }) });
    const close = await env.initializeMedia();
    try {
      const original = plain(env.useMediaStore.getState().snapshot);
      await assert.rejects(env.useMediaStore.getState().controlMedia(action), /não está disponível/);
      assert.equal(env.calls.length, 1, `Ação ${action} não pode chegar ao IPC quando ${capability} é false`);
      assert.deepEqual(plain(env.useMediaStore.getState().snapshot), original);
      assert.equal(env.useMediaStore.getState().pending, false);
      assert.match(env.useMediaStore.getState().error, /não está disponível/);
    } finally { close(); }
  }
});

test('Falha parcial de listeners preserva o dono e o botão de atualizar restaura a conexão sem vazamento', async () => {
  const env = environment();
  env.rejectListen('pedro:media-position');
  const close = await env.initializeMedia();
  assert.equal(env.listeners.size, 0);
  assert.equal(env.removed.length, 1);
  assert.equal(env.calls.length, 0);
  assert.match(env.useMediaStore.getState().error, /Listener indisponível/);
  try {
    env.rejectListen(null);
    await env.useMediaStore.getState().refreshMedia();
    assert.equal(env.listeners.size, 2);
    assert.equal(env.useMediaStore.getState().snapshot.session.title, 'Faixa atual');
    assert.equal(env.useMediaStore.getState().error, null);
    env.emit('pedro:media', snapshot({ revision: 2, sequence: 3, session: { title: 'Faixa depois da recuperação' } }));
    assert.equal(env.useMediaStore.getState().snapshot.session.title, 'Faixa depois da recuperação');
  } finally { close(); }
  assert.equal(env.listeners.size, 0);
  assert.equal(env.removed.length, 3);
});

test('Falha da leitura inicial mantém listeners de montagens concorrentes e atualizar recupera sem duplicar', async () => {
  const env = environment();
  env.handleInvoke(async () => { throw new Error('Serviço de mídia indisponível'); });
  const [closeFirst, closeSecond] = await Promise.all([env.initializeMedia(), env.initializeMedia()]);
  assert.equal(env.listeners.size, 2);
  assert.equal(env.removed.length, 0);
  assert.equal(env.calls.length, 1);
  assert.match(env.useMediaStore.getState().error, /mídia indisponível/);
  try {
    env.emit('pedro:media', snapshot({ revision: 2, session: { title: 'Evento após falha inicial' } }));
    assert.equal(env.useMediaStore.getState().snapshot.session.title, 'Evento após falha inicial');
    env.handleInvoke(async () => snapshot({ revision: 3 }));
    await env.useMediaStore.getState().refreshMedia();
    assert.equal(env.listeners.size, 2);
    assert.equal(env.trace.filter((value) => value.startsWith('listen:')).length, 2);
    assert.equal(env.calls.length, 2);
    assert.equal(env.useMediaStore.getState().snapshot.revision, 3);
    assert.equal(env.useMediaStore.getState().error, null);
    closeFirst();
    assert.equal(env.listeners.size, 2);
  } finally { closeFirst(); closeSecond(); }
  assert.equal(env.listeners.size, 0);
  assert.equal(env.removed.length, 2);
});

test('Ausência transitória conserva só a apresentação até a próxima faixa e nunca envia transporte antigo', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    const original = plain(env.useMediaStore.getState().displaySession);
    env.emit('pedro:media', snapshot({ revision: 2, session: null }));
    const updating = env.useMediaStore.getState();
    assert.equal(updating.snapshot.session, null, 'O estado Windows não pode inventar uma sessão');
    assert.equal(updating.presentationPhase, 'updating');
    assert.deepEqual(plain(updating.displaySession), original);
    await assert.rejects(updating.controlMedia('pause'), /Nenhuma reprodução/);
    assert.equal(env.calls.length, 1, 'A faixa preservada para desenho não deve receber ações');
    env.clock.advance(900);
    env.emit('pedro:media-position', { revision: 2, sequence: 3, sessionId: 'soundcloud-tab', positionSeconds: 30, durationSeconds: 180 });
    assert.equal(env.useMediaStore.getState().displaySession.positionSeconds, original.positionSeconds,
      'Ticks sem identidade autoritativa não avançam o progresso apresentado');
    env.emit('pedro:media', snapshot({ revision: 3, session: { id: 'new-tab', title: 'Nova faixa', positionSeconds: 0 } }));
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Nova faixa');
    assert.equal(env.timers.size, 0, 'A chegada da faixa cancela a expiração anterior');
    env.clock.advance(2_000);
    assert.equal(env.useMediaStore.getState().displaySession.id, 'new-tab');
  } finally { close(); }
});

test('Fechamento confirmado esvazia a apresentação no prazo original mesmo com amostras nulas repetidas', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.emit('pedro:media', snapshot({ revision: 2, session: null }));
    env.clock.advance(900);
    env.emit('pedro:media', snapshot({ revision: 2, sequence: 3, session: null }));
    env.clock.advance(env.MEDIA_PRESENTATION_GRACE_MS - 901);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'updating');
    assert.notEqual(env.useMediaStore.getState().displaySession, null);
    env.clock.advance(1);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'empty');
    assert.equal(env.useMediaStore.getState().snapshot.session, null);
    assert.equal(env.useMediaStore.getState().displaySession, null);
    env.emit('pedro:media', snapshot({ revision: 3, session: null }));
    assert.equal(env.useMediaStore.getState().presentationPhase, 'empty');
    assert.equal(env.timers.size, 0, 'Uma ausência confirmada não inicia outro intervalo');
  } finally { close(); }
});

test('Erro de leitura interrompe a atualização transitória imediatamente e a tentativa recupera a apresentação', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.emit('pedro:media', snapshot({ revision: 2, session: null }));
    env.handleInvoke(async () => { throw new Error('Falha ao consultar o Windows'); });
    await assert.rejects(env.useMediaStore.getState().refreshMedia(), /consultar o Windows/);
    const failed = env.useMediaStore.getState();
    assert.equal(failed.presentationPhase, 'unavailable');
    assert.equal(failed.displaySession, null);
    assert.match(failed.error, /consultar o Windows/);
    assert.equal(env.timers.size, 0, 'O prazo de vazio não pode apagar um erro real');
    env.clock.advance(5_000);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'unavailable');
    env.handleInvoke(async () => snapshot({ revision: 3, session: { title: 'Faixa recuperada' } }));
    await env.useMediaStore.getState().refreshMedia();
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Faixa recuperada');
    assert.equal(env.useMediaStore.getState().error, null);
  } finally { close(); }
});

test('Snapshot com erro nativo não é suavizado como intervalo entre músicas', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.emit('pedro:media', snapshot({ revision: 2, session: null, error: 'Serviço indisponível' }));
    assert.equal(env.useMediaStore.getState().presentationPhase, 'unavailable');
    assert.equal(env.useMediaStore.getState().displaySession, null);
    assert.equal(env.useMediaStore.getState().snapshot.error, 'Serviço indisponível');
    assert.equal(env.timers.size, 0);
  } finally { close(); }
});

test('Erro de leitura com sessão anterior mostra indisponibilidade e não libera transporte ao chegar leitura velha', async () => {
  const env = environment({ initial: snapshot({ revision: 4 }) });
  const close = await env.initializeMedia(); const oldRead = deferred();
  try {
    env.handleInvoke(() => oldRead.promise);
    const late = env.useMediaStore.getState().refreshMedia();
    await settle();
    env.handleInvoke(async () => { throw new Error('Windows indisponível'); });
    await assert.rejects(env.useMediaStore.getState().refreshMedia(), /Windows indisponível/);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'unavailable');
    assert.equal(env.useMediaStore.getState().displaySession.id, 'soundcloud-tab', 'Os metadados conhecidos permanecem apenas como contexto do erro');
    oldRead.resolve(snapshot({ revision: 3 }));
    await late;
    assert.equal(env.useMediaStore.getState().presentationPhase, 'unavailable');
    assert.match(env.useMediaStore.getState().error, /Windows indisponível/);
    const callsBefore = env.calls.length;
    await assert.rejects(env.useMediaStore.getState().controlMedia('pause'), /Atualize a reprodução/);
    assert.equal(env.calls.length, callsBefore);
    env.emit('pedro:media', snapshot({ revision: 5 }));
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.equal(env.useMediaStore.getState().error, null, 'Um evento autoritativo novo recupera a leitura');
  } finally { close(); }
});

test('Troca recebida antes da execução da fila cancela transporte sem enviar o ID antigo', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    const pause = env.useMediaStore.getState().controlMedia('pause');
    env.emit('pedro:media', snapshot({ revision: 2, session: { id: 'new-player', title: 'Outro player' } }));
    await assert.rejects(pause, /reprodução mudou/);
    assert.equal(env.calls.length, 1, 'Nenhum controle com identidade antiga pode cruzar o IPC');
    assert.equal(env.useMediaStore.getState().pending, false);
    env.handleInvoke(async (command, args) => {
      assert.equal(command, 'media_control');
      assert.equal(args.sessionId, 'new-player');
      return snapshot({ revision: 3, session: { id: 'new-player', playbackStatus: 'paused' } });
    });
    await env.useMediaStore.getState().controlMedia('pause');
    assert.equal(env.useMediaStore.getState().snapshot.session.playbackStatus, 'paused');
  } finally { close(); }
});

test('Comando em voo e volumes pendentes recebem eventos novos sem restaurar resposta ou metadados antigos', async () => {
  const env = environment(); const close = await env.initializeMedia();
  const pauseResponse = deferred(); const volumeResponse = deferred();
  env.handleInvoke((command, args) => {
    assert.equal(command, 'media_control');
    if (args.action === 'pause') return pauseResponse.promise;
    assert.equal(args.action, 'volume');
    assert.equal(args.sessionId, null, 'Volume usa identidade global, independente do player anterior');
    return volumeResponse.promise;
  });
  try {
    const pause = env.useMediaStore.getState().controlMedia('pause');
    const volume = env.useMediaStore.getState().controlMedia('volume', 65);
    await settle();
    env.emit('pedro:media', snapshot({ revision: 4, session: null }));
    env.clock.advance(900);
    env.emit('pedro:media', snapshot({ revision: 5, sequence: 8, session: { id: 'new-player', title: 'Faixa nova', positionSeconds: 1 } }));
    pauseResponse.resolve(snapshot({ revision: 2, session: { playbackStatus: 'paused' } }));
    await pause; await settle();
    assert.equal(env.useMediaStore.getState().pending, true);
    assert.equal(env.useMediaStore.getState().snapshot.revision, 5);
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Faixa nova');
    volumeResponse.resolve(snapshot({ revision: 3, volume: 65 }));
    await volume;
    assert.equal(env.useMediaStore.getState().snapshot.revision, 5);
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Faixa nova');
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.equal(env.useMediaStore.getState().pending, false);
    env.clock.advance(2_000);
    assert.equal(env.useMediaStore.getState().displaySession.id, 'new-player');
  } finally { close(); }
});

test('Última desmontagem limpa prazo transitório e remonte StrictMode não conserva uma apresentação fantasma', async () => {
  const env = environment();
  const [closeFirst, closeSecond] = await Promise.all([env.initializeMedia(), env.initializeMedia()]);
  env.emit('pedro:media', snapshot({ revision: 2, session: null }));
  assert.equal(env.timers.size, 1);
  closeFirst(); closeFirst();
  assert.equal(env.timers.size, 1, 'Outra montagem ainda possui a apresentação');
  closeSecond();
  assert.equal(env.timers.size, 0);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.useMediaStore.getState().displaySession, null);
  assert.equal(env.useMediaStore.getState().presentationPhase, 'empty');
  env.handleInvoke(async () => snapshot({ revision: 3, session: null }));
  const closeRestart = await env.initializeMedia();
  try {
    assert.equal(env.useMediaStore.getState().presentationPhase, 'empty');
    assert.equal(env.useMediaStore.getState().displaySession, null);
    assert.equal(env.timers.size, 0);
  } finally { closeRestart(); }
});

test('Metadados vazios conservam apenas a apresentação e ticks não prolongam a carência nem liberam controles', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    const original = plain(env.useMediaStore.getState().displaySession);
    env.emit('pedro:media', snapshot({ revision: 2, session: { title: '  ', artist: '\t' } }));
    assert.equal(env.useMediaStore.getState().presentationPhase, 'updating');
    env.clock.advance(900);
    env.emit('pedro:media-position', { revision: 2, sequence: 3, sessionId: 'soundcloud-tab', positionSeconds: 0, durationSeconds: 200 });
    assert.deepEqual(plain(env.useMediaStore.getState().displaySession), original);
    await assert.rejects(env.useMediaStore.getState().controlMedia('next'), /Nenhuma reprodução/);
    assert.equal(env.calls.length, 1, 'Uma sessão sem identidade de faixa não pode receber transporte');
    env.emit('pedro:media', snapshot({ revision: 2, sequence: 4, session: { title: '', artist: '' } }));
    env.clock.advance(env.MEDIA_PRESENTATION_GRACE_MS - 900);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'empty');
    assert.equal(env.useMediaStore.getState().displaySession, null);
    assert.equal(env.timers.size, 0);
    env.emit('pedro:media-position', { revision: 2, sequence: 5, sessionId: 'soundcloud-tab', positionSeconds: 1, durationSeconds: 200 });
    assert.equal(env.useMediaStore.getState().displaySession, null);
  } finally { close(); }
});

test('Artista informado sem título continua sendo uma identidade utilizável', async () => {
  const env = environment({ initial: snapshot({ session: { title: ' ', artist: 'Rádio ao vivo' } }) });
  const close = await env.initializeMedia();
  try {
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    env.emit('pedro:media-position', { revision: 1, sequence: 2, sessionId: 'soundcloud-tab', positionSeconds: 13, durationSeconds: 180 });
    assert.equal(env.useMediaStore.getState().displaySession.artist, 'Rádio ao vivo');
    await env.useMediaStore.getState().controlMedia('pause');
    assert.equal(env.calls.length, 2);
  } finally { close(); }
});

test('Indisponibilidade nativa tem prioridade mesmo quando o snapshot contém metadados anteriores', async () => {
  for (const failure of [{ error: 'Serviço de mídia indisponível' }, { supported: false }]) {
    const env = environment(); const close = await env.initializeMedia();
    try {
      env.emit('pedro:media', snapshot({ revision: 2, ...failure }));
      assert.equal(env.useMediaStore.getState().presentationPhase, 'unavailable');
      assert.equal(env.useMediaStore.getState().displaySession, null);
      env.emit('pedro:media-position', { revision: 2, sequence: 3, sessionId: 'soundcloud-tab', positionSeconds: 18, durationSeconds: 180 });
      assert.equal(env.useMediaStore.getState().presentationPhase, 'unavailable');
      assert.equal(env.useMediaStore.getState().displaySession, null);
      await assert.rejects(env.useMediaStore.getState().controlMedia('pause'));
      assert.equal(env.calls.length, 1);
    } finally { close(); }
  }
});

test('Falha atrasada de leitura não substitui uma faixa saudável recebida durante a consulta', async () => {
  const env = environment(); const close = await env.initializeMedia(); const reading = deferred();
  try {
    env.handleInvoke(() => reading.promise);
    const refresh = env.useMediaStore.getState().refreshMedia();
    await settle();
    env.emit('pedro:media', snapshot({ revision: 2, sequence: 3, session: { title: 'Faixa nova saudável' } }));
    reading.reject(new Error('Consulta anterior interrompida'));
    await assert.rejects(refresh, /anterior interrompida/);
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Faixa nova saudável');
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.equal(env.useMediaStore.getState().error, null);
  } finally { close(); }
});

test('Leitura antiga com a mesma revisão não desfaz falha de uma consulta posterior', async () => {
  const env = environment(); const close = await env.initializeMedia(); const reading = deferred();
  try {
    env.handleInvoke(() => reading.promise);
    const older = env.useMediaStore.getState().refreshMedia();
    await settle();
    env.handleInvoke(async () => { throw new Error('Consulta mais recente falhou'); });
    await assert.rejects(env.useMediaStore.getState().refreshMedia(), /mais recente/);
    reading.resolve(snapshot());
    await older;
    assert.equal(env.useMediaStore.getState().presentationPhase, 'unavailable');
    assert.match(env.useMediaStore.getState().error, /mais recente/);
  } finally { close(); }
});

test('Tick autoritativo saudável recupera falha de leitura sem depender da próxima troca de faixa', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.handleInvoke(async () => { throw new Error('Consulta indisponível'); });
    await assert.rejects(env.useMediaStore.getState().refreshMedia());
    env.emit('pedro:media-position', { revision: 1, sequence: 2, sessionId: 'soundcloud-tab', positionSeconds: 15, durationSeconds: 180 });
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.equal(env.useMediaStore.getState().error, null);
    assert.equal(env.useMediaStore.getState().displaySession.positionSeconds, 15);
  } finally { close(); }
});

test('Erro de transporte permanece visível nos ticks, mas não acompanha uma nova faixa saudável', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.handleInvoke(async () => { throw new Error('O player recusou o comando de música'); });
    await assert.rejects(env.useMediaStore.getState().controlMedia('next'), /recusou/);
    env.emit('pedro:media-position', { revision: 1, sequence: 2, sessionId: 'soundcloud-tab', positionSeconds: 15, durationSeconds: 180 });
    assert.match(env.useMediaStore.getState().error, /recusou/, 'Posição não confirma sucesso de transporte');
    env.emit('pedro:media', snapshot({ revision: 1, sequence: 3 }));
    assert.match(env.useMediaStore.getState().error, /recusou/, 'O mesmo contexto de reprodução não confirma sucesso de transporte');
    env.emit('pedro:media', snapshot({ revision: 2, sequence: 4, session: { title: 'Faixa seguinte' } }));
    assert.equal(env.useMediaStore.getState().error, null);
    assert.equal(env.calls.filter(call => call.command === 'media_control').length, 1, 'Uma recusa nunca reenvia automaticamente o skip');
  } finally { close(); }
});

test('Falha de leitura não reintroduz metadados vazios, e ticks sem identidade válida não recuperam a fase', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.emit('pedro:media', snapshot({ revision: 2, session: { title: ' ', artist: '' } }));
    env.handleInvoke(async () => { throw new Error('Consulta interrompida'); });
    await assert.rejects(env.useMediaStore.getState().refreshMedia());
    assert.equal(env.useMediaStore.getState().displaySession, null);
    env.emit('pedro:media-position', { revision: 2, sequence: 3, sessionId: 'soundcloud-tab', positionSeconds: 15, durationSeconds: 180 });
    assert.equal(env.useMediaStore.getState().displaySession, null);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'unavailable');
    assert.match(env.useMediaStore.getState().error, /interrompida/);
  } finally { close(); }
});

test('Recuperar a leitura com ticks não apaga uma recusa legítima de volume', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.handleInvoke(async command => { throw new Error(command === 'media_snapshot' ? 'Consulta interrompida' : 'Não foi possível ajustar o volume'); });
    await assert.rejects(env.useMediaStore.getState().refreshMedia());
    await assert.rejects(env.useMediaStore.getState().controlMedia('volume', 60), /ajustar o volume/);
    env.emit('pedro:media-position', { revision: 1, sequence: 2, sessionId: 'soundcloud-tab', positionSeconds: 15, durationSeconds: 180 });
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.match(env.useMediaStore.getState().error, /ajustar o volume/);
    env.emit('pedro:media', snapshot({ revision: 2, session: { title: 'Faixa seguinte' } }));
    assert.match(env.useMediaStore.getState().error, /ajustar o volume/, 'Uma mudança de faixa não confirma um ajuste de volume');
    env.handleInvoke(async () => snapshot({ revision: 2 }));
    await env.useMediaStore.getState().refreshMedia();
    assert.equal(env.useMediaStore.getState().error, null);
  } finally { close(); }
});

test('Rejeição atrasada de transporte não acrescenta erro à faixa que já se recuperou por evento', async () => {
  const env = environment(); const close = await env.initializeMedia(); const command = deferred();
  try {
    env.handleInvoke(() => command.promise);
    const skip = env.useMediaStore.getState().controlMedia('next');
    await settle();
    env.emit('pedro:media', snapshot({ revision: 2, session: { id: 'new-player', title: 'Faixa recuperada' } }));
    command.reject(new Error('A sessão de música mudou'));
    await assert.rejects(skip, /sessão de música mudou/);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.equal(env.useMediaStore.getState().error, null);
    assert.equal(env.useMediaStore.getState().pending, false);
    assert.equal(env.calls.filter(call => call.command === 'media_control').length, 1);
  } finally { close(); }
});

test('Seek para frente, trás e zero e timeline ausente não removem uma faixa com identidade válida', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    for (const [index, positionSeconds] of [90, 10, 0, null].entries()) {
      env.emit('pedro:media-position', { revision: 1, sequence: index + 2, sessionId: 'soundcloud-tab', positionSeconds,
        durationSeconds: positionSeconds === null ? null : 180 });
      const state = env.useMediaStore.getState();
      assert.equal(state.presentationPhase, 'ready');
      assert.equal(state.displaySession.title, 'Faixa atual');
      assert.equal(state.displaySession.positionSeconds, positionSeconds);
      assert.equal(env.timers.size, 0);
    }
    assert.equal(env.calls.length, 1, 'Seek observado não dispara leitura nem comando do frontend');
  } finally { close(); }
});

test('Busca nativa inicial permanece carregando além da carência sem inventar faixa', async () => {
  const env = environment({ initial: snapshot({ session: null, sessionUpdating: true }) });
  const close = await env.initializeMedia();
  try {
    assert.equal(env.useMediaStore.getState().initialized, true);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'loading');
    env.clock.advance(env.MEDIA_PRESENTATION_GRACE_MS * 3);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'loading');
    assert.equal(env.useMediaStore.getState().displaySession, null);
    assert.equal(env.timers.size, 0, 'O prazo da operação nativa pertence ao backend');
    env.emit('pedro:media', snapshot({ revision: 2, sessionUpdating: false, session: { title: 'Leitura concluída' } }));
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Leitura concluída');
  } finally { close(); }
});

test('Contexto nativo em atualização conserva identidade sem controles nem promoção por ticks', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.emit('pedro:media', snapshot({ revision: 2, sessionUpdating: true }));
    const context = plain(env.useMediaStore.getState().displaySession);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'updating');
    await assert.rejects(env.useMediaStore.getState().controlMedia('next'), /atualizando/);
    env.emit('pedro:media-position', { revision: 2, sequence: 3, sessionId: 'soundcloud-tab', positionSeconds: 90, durationSeconds: 180 });
    env.clock.advance(env.MEDIA_PRESENTATION_GRACE_MS * 3);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'updating');
    assert.deepEqual(plain(env.useMediaStore.getState().displaySession), context);
    assert.equal(env.timers.size, 0);
    assert.equal(env.calls.filter(call => call.command === 'media_control').length, 0);
    env.emit('pedro:media', snapshot({ revision: 3, sequence: 4, sessionUpdating: false, session: { title: 'Faixa recuperada', positionSeconds: 91 } }));
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Faixa recuperada');
    assert.equal(env.useMediaStore.getState().error, null);
  } finally { close(); }
});

test('Busca nativa com contexto suspende carência anterior e fechamento real começa um novo prazo', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.emit('pedro:media', snapshot({ revision: 2, session: null }));
    env.clock.advance(900);
    env.emit('pedro:media', snapshot({ revision: 3, session: null, sessionUpdating: true }));
    env.clock.advance(env.MEDIA_PRESENTATION_GRACE_MS * 3);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'updating');
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Faixa atual');
    assert.equal(env.timers.size, 0);
    env.emit('pedro:media', snapshot({ revision: 4, session: null, sessionUpdating: false }));
    env.clock.advance(env.MEDIA_PRESENTATION_GRACE_MS - 1);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'updating');
    env.clock.advance(1);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'empty');
    assert.equal(env.useMediaStore.getState().displaySession, null);
  } finally { close(); }
});

test('Falha nativa tem prioridade sobre o sinal de busca e atualização', async () => {
  for (const session of [null, {}]) {
    const env = environment({ initial: snapshot({ session, sessionUpdating: true, error: 'Serviço indisponível' }) });
    const close = await env.initializeMedia();
    try {
      assert.equal(env.useMediaStore.getState().presentationPhase, 'unavailable');
      assert.equal(env.useMediaStore.getState().displaySession, null);
      assert.equal(env.timers.size, 0);
    } finally { close(); }
  }
});

test('Reconciliação de cache recupera a faixa sem limpar erro de volume ou enviar transporte', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.handleInvoke(async () => { throw new Error('Falha legítima de volume'); });
    await assert.rejects(env.useMediaStore.getState().controlMedia('volume', 60), /volume/);
    env.handleInvoke(async command => {
      assert.equal(command, 'media_snapshot');
      return snapshot({ revision: 2, session: { title: 'Faixa reencontrada' } });
    });
    await env.useMediaStore.getState().reconcileMedia();
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Faixa reencontrada');
    assert.match(env.useMediaStore.getState().error, /volume/);
    assert.equal(env.calls.filter(call => call.command === 'media_control').length, 1);
    env.handleInvoke(async () => { throw new Error('Falha de leitura ao recuperar foco'); });
    await assert.rejects(env.useMediaStore.getState().reconcileMedia(), /recuperar foco/);
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.match(env.useMediaStore.getState().error, /volume/);
  } finally { close(); }
});

test('Falha quieta posterior não descarta a recuperação de uma tentativa explícita em andamento', async () => {
  const env = environment(); const close = await env.initializeMedia(); const recovery = deferred();
  try {
    env.handleInvoke(async () => { throw new Error('Leitura inicial indisponível'); });
    await assert.rejects(env.useMediaStore.getState().refreshMedia(), /inicial indisponível/);
    env.handleInvoke(() => recovery.promise);
    const retry = env.useMediaStore.getState().refreshMedia();
    await settle();
    env.handleInvoke(async () => { throw new Error('Wake não conseguiu ler o cache'); });
    await assert.rejects(env.useMediaStore.getState().reconcileMedia(), /Wake/);
    recovery.resolve(snapshot({ revision: 2, session: { title: 'Reprodução recuperada' } }));
    await retry;
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.equal(env.useMediaStore.getState().displaySession.title, 'Reprodução recuperada');
    assert.equal(env.useMediaStore.getState().error, null);
  } finally { close(); }
});

test('Atualização nativa após skip não oculta uma recusa nem trata a mesma faixa recuperada como sucesso', async () => {
  const env = environment(); const close = await env.initializeMedia(); const response = deferred();
  try {
    env.handleInvoke(() => response.promise);
    const skip = env.useMediaStore.getState().controlMedia('next');
    await settle();
    env.emit('pedro:media', snapshot({ revision: 2, sessionUpdating: true }));
    response.reject(new Error('O player recusou o comando de música'));
    await assert.rejects(skip, /recusou/);
    assert.match(env.useMediaStore.getState().error, /recusou/);
    env.emit('pedro:media', snapshot({ revision: 3, sessionUpdating: false }));
    assert.equal(env.useMediaStore.getState().presentationPhase, 'ready');
    assert.match(env.useMediaStore.getState().error, /recusou/, 'Reler os mesmos metadados não confirma o skip');
    env.emit('pedro:media', snapshot({ revision: 4, session: { title: 'Outra faixa confirmada' } }));
    assert.equal(env.useMediaStore.getState().error, null);
    assert.equal(env.calls.filter(call => call.command === 'media_control').length, 1);
  } finally { close(); }
});

test('Mudanças de volume, capa ou sinal de atualização não apagam uma recusa de transporte', async () => {
  const env = environment(); const close = await env.initializeMedia();
  try {
    env.handleInvoke(async () => { throw new Error('Pausa recusada pelo player'); });
    await assert.rejects(env.useMediaStore.getState().controlMedia('pause'), /recusada/);
    for (const update of [
      snapshot({ revision: 2, volume: 70 }),
      snapshot({ revision: 3, sessionUpdating: true }),
      snapshot({ revision: 4, session: { artwork: 'data:image/png;base64,bmV3' } }),
    ]) {
      env.emit('pedro:media', update);
      assert.match(env.useMediaStore.getState().error, /recusada/);
    }
    env.emit('pedro:media', snapshot({ revision: 5, session: { playbackStatus: 'paused' } }));
    assert.equal(env.useMediaStore.getState().error, null, 'Um novo estado de reprodução confirmado torna o contexto anterior obsoleto');
  } finally { close(); }
});
