import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { buildCandidate } from '../tools/buildCandidate.mjs';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
const require = createRequire(import.meta.url);
const acorn = require('../tools/vendor/acorn');
let built;

// Execute real patched stock declarations without starting the server, microphone,
// SDK, sockets or native game. Only external I/O and unrelated scene presentation
// are replaced. The turn store, routing, parser and lifecycle hooks are real code.
export async function stockHarness(provider = 'openai', { config = {}, env = {}, fetchImpl = () => { throw new Error('network forbidden'); } } = {}) {
  built ||= buildCandidate(); await built;
  const source = await readFile(new URL('../dist/plugins/LosSantosAliveServer/server.bundle.mjs', import.meta.url), 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const variables = new Map();
  for (const statement of ast.body) if (statement.type === 'VariableDeclaration') for (const d of statement.declarations) variables.set(d.id.name, source.slice(d.start,d.end));
  const select = ['Ht','Z','Pe','ke','Ee','BM','$M','hy','Va','It','ae','yn','hv','Nd','u4','p4','b4'];
  const runtime = createRuntime(normalizeConfig({ provider, ...config }, env), { fetchImpl });
  const sent = [], actions = [], logs = [];
  const context = vm.createContext({ Buffer, console, setTimeout, clearTimeout, queueMicrotask, Date, Map, Set, __LSA_E1_RUNTIME: runtime });
  context.sent = sent; context.actions = actions; context.logs = logs;
  vm.runInContext(ast.body.filter(n => n.type === 'FunctionDeclaration').map(n => source.slice(n.start,n.end)).join('\n'), context);
  vm.runInContext(select.map(name => { if (!variables.has(name)) throw new Error(`Missing ${name}`); return `var ${variables.get(name)};`; }).join('\n'), context);
  vm.runInContext(`
    var od = new Set(), id = null, TP = true, Vy = {}, vb = {}, Ha = AP;
    var A = { playerPedId: 'player', sessionsByPedId: new Map(), sessionNoncesByPedId: new Map(),
      outputOwnerByPedId: new Map(), retiringOutputOwnerByPedId: new Map(), pendingOutputOwnerByPedId: new Map(),
      turnsById: new Map(), activeTurnIdByPedId: new Map(), generationByPedId: new Map(), turnSerial: 0,
      geminiAudioChunks: [], actorSessionStates: new Map(), pendingPlayerContextByPedId: new Map(), context: {},
      audioEndpoint: { connected: true, ready: true, protocolVersion: 3, supportsTurnIdentity: true,
        supportsStreamEnded: true, supportsExactInterrupt: true, supportsPlaybackStarted: true, supportsStaleGenerationRejection: true } };
    var le = new hy(A);
    se = (...args) => logs.push(args); Ji = se; gy = () => {}; vt = () => {}; vP = () => {}; tl = () => {}; $a = () => {};
    yi = () => []; Pb = () => []; Qt = (_, message) => { sent.push(message); return 1; };
    Ba = ({transcript}) => ({ recipientPedId: 'player', recipientIsPlayer: true, spokenText: transcript });
    z0 = () => null; PP = () => false;
    wb = (_, action, parameter, tag, pedId, transcript, target) => { actions.push({ action, parameter, tag, pedId, target }); return true; };
    xn(N4);
  `, context);
  const bridgeStatement = ast.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee?.object?.name === '__LSA_E1_RUNTIME' && n.expression.callee?.property?.name === 'attachBridge');
  if (!bridgeStatement) throw new Error('Patched bridge missing');
  vm.runInContext(source.slice(bridgeStatement.start,bridgeStatement.end),context);
  const evaluate = code => vm.runInContext(code,context);
  return { runtime, context, sent, actions, logs, evaluate,
    async openAIControllerSession({ pedId = '17', nonce = 1, actorContext = { pedId, roleName: 'Civilian' }, targetContext = { pedId: 'player' } } = {}) {
      const connection = await runtime.createTransport(() => { throw new Error('Gemini must not be constructed'); }).connect({
        systemInstruction: 'stock controller test', actorContext, targetContext,
        diagnosticContext: { pedId, sessionNonce: nonce },
      });
      context.testPed = pedId; context.testNonce = nonce; context.testActor = actorContext; context.testTarget = targetContext; context.controllerConnection = connection;
      evaluate(`
        var controllerSession = { pedId: testPed, nonce: testNonce, status: 'ready', provider: 'openai',
          actorContext: testActor, targetContext: testTarget, systemInstruction: 'stock controller test', connection: null };
        A.sessionNoncesByPedId.set(testPed,testNonce); A.sessionsByPedId.set(testPed,controllerSession);
        A.activeActor = testActor; A.context = { target: testTarget, contextUpdate: '' };
        controllerSession.connection = controllerConnection;
        xs = () => {}; oa = () => {};
        jK = () => {}; Ad = async () => true;
        za = async (ped, reason) => { const active = le.getActiveTurnForPed(ped); if (active) await Qi(active.id, reason); return true; };
        Zc = () => 'stock context';
        Zi = async ({ pedId }) => A.sessionsByPedId.get(pedId);
        M4 = async ({ speakerPedId, listenerPedId }) => ({ actorContext: { ...testActor, pedId: speakerPedId },
          targetContext: listenerPedId ? { ...testTarget, pedId: listenerPedId } : null, world: { location: 'stock' } });
        Xa = () => {}; MK = false;
      `);
      const autoNativeAcks = ({ completePlayback = true } = {}) => {
        context.autoNativeAck = message => {
          if (message.type === 'npcAudioTurnStart') queueMicrotask(() => { context.pendingNativeMessage = message; evaluate('by({ ...pendingNativeMessage, type: "npcAudioTurnAccepted" })'); });
          if (completePlayback && message.type === 'npcAudioStreamEnded') queueMicrotask(() => { context.pendingNativeMessage = message; evaluate('by({ ...pendingNativeMessage, type: "npcPlaybackEnded", reason: "completed", hadAudio: true, playbackStarted: true, wasInterrupted: false })'); });
        };
        evaluate('Qt = (_, message) => { sent.push(message); autoNativeAck(message); return 1; }');
      };
      return { connection, autoNativeAcks, session: evaluate('controllerSession') };
    },
    create: (pedId = '17', nonce = 1, sessionProvider = provider) => {
      context.testPed = pedId; context.testNonce = nonce; context.testProvider = sessionProvider;
      return evaluate(`
        A.sessionNoncesByPedId.set(testPed,testNonce);
        var session = { pedId: testPed, nonce: testNonce, status: 'ready', provider: testProvider,
          actorContext: { pedId: testPed }, systemInstruction: 'stock', connection: { beginTurn: t => { globalThis.bound = t; } } };
        A.sessionsByPedId.set(testPed,session);
        var turn = le.createTurn({ pedId: testPed, source: Ht.PLAYER_TEXT });
        Xn(turn.id,{ sessionRecord: session });
        ({ pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: testNonce });
      `);
    },
  };
}
