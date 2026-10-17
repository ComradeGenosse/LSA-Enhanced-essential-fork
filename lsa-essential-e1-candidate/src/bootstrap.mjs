import {projectCapabilityHealth,loadCapabilityValidation} from './observability/capabilityHealth.mjs';
import {createHash} from 'node:crypto';
import {dialogueKnowledgeContractSupported} from './config/dialogueKnowledge.mjs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config/e1Config.mjs';
import * as essentialRuntimeGlue from './integration/essentialGlue.mjs';
const {createRuntime}=essentialRuntimeGlue;
import { loadPrivateEnvironment } from './config/privateEnvironment.mjs';
import { createFileSink } from './observability/fileSink.mjs';
import { Telemetry, createNoopTelemetry } from './observability/telemetry.mjs';
import { identityContractSupported } from './identity/nativeSupport.mjs';
import { startCharacterEditor } from './characters/editorServer.mjs';
import { defaultControlEndpointPath } from './control/endpointFile.mjs';
import { characterContractSupported } from './characters/nativeSupport.mjs';
import { IntelligenceClient } from './perception/intelligenceClient.mjs';
import { loadRadioTrackTextCatalog } from './perception/radioTrackTextCatalog.mjs';
import {DirectorObservationPump} from './perception/directorProduction.mjs';
import {directorSpeechLimitsForPreset} from './perception/sceneDirector.mjs';
import {DirectorSpeechReservations} from './perception/sceneDirectorAdmission.mjs';
import {SceneDirectorSpeech} from './perception/sceneDirectorOrchestrator.mjs';
import { ActivityClient } from './activities/activityClient.mjs';
import { ActivityRuntime } from './activities/activityRuntime.mjs';
import { ReactionClient } from './reactions/reactionClient.mjs';
import { createReactionService } from './reactions/reactionService.mjs';
import { perceptionContractSupported } from './perception/nativeSupport.mjs';
import { createDialogueTrace, createNoopDialogueTrace } from './observability/dialogueTrace.mjs';
import {createM3ProductionMemory} from './memory/m3ProductionMemory.mjs';
import {createMemoryD02Port} from './memory/memoryD02Port.mjs';
import {resolveMemoryKCapabilities} from './memory/capabilityPolicy.mjs';
import {createMemoryKRuntimeComposition,memoryKDialogueActivation,memoryKM6Activation,memoryKM7Activation,runtimeCleanupError} from './memory/runtimeComposition.mjs';
import {createM6RuntimeRetention} from './memory/m6RuntimeRetention.mjs';
import {createM7RuntimeCuration} from './memory/m7RuntimeCuration.mjs';
import {memoryKSourceActivation} from './memory/sourceActivation.mjs';
import {bindTrustedTimelineSource} from './characters/timelineSourceBridge.mjs';
import {memoryKM3Activation,unavailableM3States} from './memory/m3Activation.mjs';
import {createInspectorControls} from './memory/inspectorControls.mjs';
import {withLearnedMemoryPause} from './memory/learnedMemoryPause.mjs';

export async function createRuntimeForBundle(options = {}) {
  // Explicit test/embedding environments remain isolated from local secrets.
  const env = options.env !== undefined && options.envFilePath === undefined
    ? options.env
    : await loadPrivateEnvironment(options);
  let config = await loadConfig({ ...options, env });
  if(config.memoryK.profile==='storage-only') {
    if(config.provider!=='openai'||!config.promotedCharacters.enabled||
       config.promotedCharacters.storageMode!=='sqlite'||!config.persistentIdentity.enabled)
      throw new Error('storage_only_requires_openai_p1_p2_sqlite');
    // C is a separately reviewed prerequisite. Fail before constructing any
    // storage/channel/consumer on a checkout where its enforcement is absent.
    if(essentialRuntimeGlue.MEMORY_K_COMPOSITION_VERSION!==1)
      throw new Error('storage_only_composition_unavailable');
  }
  if (config.persistentIdentity.enabled) {
    let contract = options.identityContract;
    if (contract === undefined) {
      try { contract = JSON.parse(await readFile(new URL('../build-manifest.json', import.meta.url), 'utf8')).identityContract; } catch {}
    }
    if (!identityContractSupported(contract)) {
      config = Object.freeze({ ...config, persistentIdentity: Object.freeze({ ...config.persistentIdentity, enabled: false }) });
      try { console.warn('[P1] Persistence disabled (optional_identity_contract_unavailable).'); } catch {}
    }
  }
  if (config.promotedCharacters.enabled) {
    let contract = options.characterContract;
    if (contract === undefined) try { contract = JSON.parse(await readFile(new URL('../build-manifest.json',import.meta.url),'utf8')).characterContract; } catch {}
    config = Object.freeze({ ...config,promotedCharacters:Object.freeze({ ...config.promotedCharacters,nativeSupported:characterContractSupported(contract) }) });
  }
  const composition=createMemoryKRuntimeComposition(config);
  const m3Activation=memoryKM3Activation(config);
  const owner=composition.scope;
  try {
  let telemetry = options.telemetry;
  if (!telemetry) {
    const entry = path.basename(process.argv[1] || '');
    const enabled = options.enableTelemetry === true || (!Object.hasOwn(options, 'enableTelemetry') && entry === 'server.bundle.mjs');
    if (enabled && config.observabilityEnabled) {
      try {
        let manifest = {};
        try { manifest = JSON.parse(await readFile(path.resolve(process.cwd(), 'build-manifest.json'), 'utf8')); } catch {}
        const sink = await createFileSink({
          directory: options.telemetryDirectory || path.resolve(process.cwd(), 'logs'),
          maxFileBytes: config.observabilityMaxFileBytes,
          maxTotalBytes: config.observabilityMaxTotalBytes,
          maxFiles: config.observabilityMaxFiles,
          onFailure: ({ code }) => { try { console.warn(`[E1 telemetry] persistent logging disabled (${code}).`); } catch {} },
        });
        telemetry = new Telemetry({ sink, run: {
          provider: config.provider, model: config.reasoningModel, nodeVersion: process.version,
          parentPid: process.ppid, bundleHash: options.bundleHash, dllHash: options.dllHash,
          providerWorkDeadlineMs: config.providerWorkDeadlineMs, playbackCompletionMaxMs: config.playbackCompletionMaxMs,
          credentialAvailable: Boolean(config.reasoningKey || config.transcriptionKey || config.ttsKey),
          bundleHash: manifest.builtBundleSha256, dllHash: manifest.nativeContract?.dllSha256,
        } });
        owner.own('telemetry',telemetry,value=>value.close());
      } catch (error) {
        try { console.warn(`[E1 telemetry] persistent logging unavailable (${/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'initialization_failed'}).`); } catch {}
        telemetry = createNoopTelemetry();
      }
    } else telemetry = createNoopTelemetry();
  }
  let dialogueTrace = options.dialogueTrace || createNoopDialogueTrace();
  if (!options.dialogueTrace && config.provider === 'openai' && config.dialogueLogging.enabled) {
    try {
      const sink = await createFileSink({
        directory: options.dialogueDirectory || path.resolve(process.cwd(), 'logs', 'dialogue'),
        maxFileBytes: config.dialogueLogging.maxFileBytes,
        maxTotalBytes: config.dialogueLogging.maxTotalBytes,
        maxFiles: config.dialogueLogging.maxFiles,
        onFailure: ({ code }) => { try { console.warn(`[E1 dialogue] persistent logging disabled (${code}).`); } catch {} },
      });
      dialogueTrace = createDialogueTrace({ sink, telemetryRunId: telemetry?.runId || null, config: config.dialogueLogging,
        secrets: [config.reasoningKey, config.transcriptionKey, config.ttsKey] });
      owner.own('dialogueTrace',dialogueTrace,value=>value.close());
    } catch (error) {
      try { console.warn(`[E1 dialogue] persistent logging unavailable (${/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'initialization_failed'}).`); } catch {}
      dialogueTrace = createNoopDialogueTrace();
    }
  }
  // The existing host starts before the authenticated native pipe. Keep a
  // single source-fenced read-through authority; absence must stay unknown.
  let connectedMemoryAuthority=null;
  const memoryAuthorityPort=Object.freeze({
    verifyCurrentTurn:x=>connectedMemoryAuthority?.verifyCurrentTurn(x)??null,
    resolveNativeOwner:x=>connectedMemoryAuthority?.resolveNativeOwner(x)??null,
    resolveParticipants:x=>connectedMemoryAuthority?.resolveParticipants(x)??null,
    resolvePrepromotion:x=>connectedMemoryAuthority?.resolvePrepromotion(x)??null,
    verifyNativeCoverage:x=>connectedMemoryAuthority?.verifyNativeCoverage(x)??null
  });
  // Production cannot accept a caller-supplied emotional protagonist authority:
  // only native C-13 may issue it. Keep test injection confined to createRuntime().
  const {verifiedProtagonistAuthority:ignoredTestAuthority,...safeRuntimeOptions}=options;
  const runtime = createRuntime(config, { ...safeRuntimeOptions,
    deferCharacterInitialization:true,
    memoryNativeAuthority:options.memoryNativeAuthority??memoryAuthorityPort,
    telemetry, dialogueTrace });
  owner.own('essential.connections',runtime,value=>value.closeConnections());
  if(runtime.identityService) owner.own('p1.identity',runtime.identityService,value=>value.close({closeEvidence:!options.identityEvidence}));
  // Initialize the single P2 writer before registering consumers. Bootstrap
  // owns the lifetime; direct createRuntime callers retain their old behavior.
  if(runtime.characterService) {
    owner.starting('p2.storage');
    owner.own('p2.storage',runtime.characterService,value=>value.closeStorage());
    const ready=await runtime.characterService.initialize();
    if(!ready) {
      owner.failed('p2.storage');
      // SQLite activation cannot silently become an unavailable JSON runtime.
      if(config.promotedCharacters.storageMode==='sqlite') throw new Error('p2_sqlite_startup_failed');
    }
  }
  // J-B: opt-in M6 deterministic retention over the SAME P2 store. Default off;
  // M7/Luna cloud curation is never constructed here. Idle ticks, scene close and
  // startup recovery are driven by the retention module, off the foreground path.
  if(memoryKM6Activation(config).mode==='on'&&!runtime.memoryPause.paused&&
     config.promotedCharacters?.storageMode==='sqlite'&&runtime.characterService?.ready===true){
    try{
      const retentionStore=runtime.memoryPause.optionalStore(runtime.characterService.store);
      const retention=createM6RuntimeRetention({store:retentionStore,
        isPaused:()=>runtime.memoryPause.paused||runtime.closed===true,
        // M6 may append durable jobs for M7 only when M7 is independently on.
        cloudQueue:memoryKM7Activation(config).mode==='on',
        ...options.m6RetentionOptions});
      owner.own('memory.retention',retention,value=>value.dispose());
      runtime.retention=retention;
      retention.start();
    }catch{owner.failed('memory.retention');runtime.retention=null;try{console.warn('[M6] retention_runtime_unavailable');}catch{}}
  }
  // M7 Luna cloud curation over the SAME P2 store. Default off. It is independent
  // of M2/M3/M4/H1/M8 and of whether M6 runs: it processes whatever authorized
  // jobs the durable queue holds. It performs no network request until persisted
  // consent, supported Luna pricing and a native idle proof all hold.
  if(memoryKM7Activation(config).mode==='on'&&!runtime.memoryPause.paused&&
     config.promotedCharacters?.storageMode==='sqlite'&&runtime.characterService?.ready===true){
    try{
      const cloudStore=runtime.memoryPause.optionalStore(runtime.characterService.store);
      const cloudCuration=createM7RuntimeCuration({config,store:cloudStore,
        isPaused:()=>runtime.memoryPause.paused||runtime.closed===true,
        subscribePause:listener=>runtime.memoryPause.subscribe(listener),
        // Authenticated native producer only. None is registered by the pinned
        // Core today (see W07), so the state stays blocked until one exists.
        nativeIdleSource:()=>options.m7NativeIdleSource??runtime.intelligence?.m7NativeIdleSource??null,
        fetchImpl:options.fetchImpl??globalThis.fetch,
        ...options.m7CloudCurationOptions});
      owner.own('memory.cloudCuration',cloudCuration,value=>value.dispose());
      runtime.cloudCuration=cloudCuration;
      cloudCuration.start();
    }catch{owner.failed('memory.cloudCuration');runtime.cloudCuration=null;try{console.warn('[M7] cloud_curation_runtime_unavailable');}catch{}}
  }
  runtime.services.memoryKRuntimeDiagnostics=()=>withLearnedMemoryPause(composition.snapshot(Object.fromEntries(
    Object.entries(runtime.services.memoryKCapabilities()).map(([id,row])=>[id,row.registrationStatus])),{
      ...runtime.intelligence?.operationalStates(),
      ...(runtime.memoryM3?.operationalStates()??unavailableM3States(m3Activation)),
      ...runtime.services.memoryDialogueDiagnostics(),
      'memory.journalContext':runtime.services.memoryJournalDiagnostics(),
      'memory.recall':runtime.services.memoryRecallDiagnostics(),
      'memory.commands':runtime.services.memoryCommandDiagnostics(),
      'memory.interpretation':runtime.services.memoryInterpretationDiagnostics(),
      'memory.deterministic':runtime.services.memoryRetentionDiagnostics(),
      'memory.cloudCuration':runtime.services.memoryCloudCurationDiagnostics(),
      ...(runtime.memoryD02?{'authority.d02':Object.freeze({requestedMode:'on',
        state:runtime.closed?'stopped':runtime.memoryD02.status().settled?'operational':'waiting',
        effectiveMode:runtime.closed?'off':runtime.memoryD02.status().settled?'on':null,
        operationalState:runtime.closed?'stopped':runtime.memoryD02.status().settled?'operational':'waiting',
        reason:runtime.memoryD02.status().settled?null:'d02_owner_authority_unavailable'})}:{})}),runtime.memoryPause);
  runtime.dispose=()=>owner.dispose();
  runtime.shutdown=runtime.dispose;
  let restarting=null;
  runtime.restart=()=>restarting??=(async()=>{
    const result=await runtime.dispose();
    if(result.failures.length) throw runtimeCleanupError(owner,result.failures,'runtime_disposal_failed');
    return createRuntimeForBundle(options);
  })().catch(error=>{restarting=null;throw error;});
  let capabilityManifest=null,capabilityPayloadHash=null,capabilityValidation=Object.freeze([]);
  try {const bytes=await readFile(new URL('../build-manifest.json',import.meta.url));capabilityManifest=JSON.parse(bytes);capabilityPayloadHash=createHash('sha256').update(bytes).digest('hex');}catch{}
  capabilityValidation=await loadCapabilityValidation(options.capabilityValidationPath??path.resolve(process.cwd(),'diagnostics/validation.v1.json'));
  runtime.services.capabilityHealth=()=>projectCapabilityHealth({config,manifest:capabilityManifest,payloadHash:capabilityPayloadHash,validation:capabilityValidation,perception:runtime.intelligence?.runtime,activities:runtime.activities});
  // Workstream B read model. Construction/registration does not establish that
  // a source is fresh, P2 has a healthy writer, D02 has a current owner, or
  // that optional capture was turned on/off. No probe calls mutate authority.
  runtime.services.memoryKDiagnostics=()=>{
    const store=runtime.characterService?.store;
    const source=runtime.intelligence?.runtime;
    const registered={
      'source.core':!!runtime.intelligence && !!source,
      'p2.sqlite':config.promotedCharacters.storageMode==='sqlite' &&
        runtime.characterService?.ready===true &&
        typeof store?.withP2SqliteTransaction==='function',
      'authority.d02':!!runtime.memoryD02,
      // M3 owns its distinct authenticated witness-authority port. A supplied
      // test authority is only a registered seam, never production proof.
      'authority.witness':!!runtime.memoryM3 &&
        (!!connectedMemoryAuthority || typeof options.memoryNativeAuthority?.resolveNativeOwner==='function'),
      'ps4.assembler':typeof runtime.services.finalizeKnowledgeFrame==='function',
      // Code presence != verified suppression / privacy enforcement.
      'privacy.core':config.promotedCharacters.storageMode==='sqlite' &&
        typeof store?.withP2SqliteRead==='function',
      'ps1.producers':!!runtime.intelligence,
      'ps2.observations':!!source?.correlator,
      'ps3.salience':!!source?.salience,
      'ps4.perceived':runtime.dialogueKnowledgeBuildSupported===true,
      'ps6.speech':!!runtime.director,
      'memory.dialogue.player':typeof runtime.services.bindM2Turn==='function' &&
        !!runtime.memoryD02,
      'memory.dialogue.npc':typeof runtime.services.recordM2Npc==='function' &&
        !!runtime.memoryD02,
      'memory.events':!!runtime.memoryM3&&m3Activation.events.mode!=='off',
      'memory.coverage':!!runtime.memoryM3&&m3Activation.coverage.mode!=='off'&&!!connectedMemoryAuthority,
      'memory.journalContext':typeof runtime.services.memoryJournalDiagnostics==='function',
      'memory.recall':typeof runtime.services.memoryRecallDiagnostics==='function',
      'memory.commands':typeof runtime.services.memoryCommandDiagnostics==='function',
      'memory.deterministic':!!runtime.retention,
      'memory.cloudCuration':!!runtime.cloudCuration,
      'memory.interpretation':typeof runtime.services.memoryInterpretationDiagnostics==='function',
    };
    const environment=Object.freeze({
      source:Object.freeze({
        registered:registered['source.core'], hostContextObserved:!!source?.hostContext,
        freshness:'unverified',
      }),
      storage:Object.freeze({
        registered:registered['p2.sqlite'],initialized:runtime.characterService?.ready===true,
        // Snapshot only: not a transaction or integrity/owner receipt.
        timelineWritableSnapshot:store?.timelineWritable===true,
        timelineConfirmation:'unverified',writerHealth:'unverified',
      }),
      native:Object.freeze({
        d02Registered:registered['authority.d02'],currentOwnerProof:'unverified',
        m3WitnessAuthorityRegistered:registered['authority.witness'],m3WitnessProof:'unverified',
      }),
      ps4:Object.freeze({assemblerRegistered:registered['ps4.assembler'],soleWriterAdmission:'unverified'}),
      privacy:Object.freeze({
        portRegistered:registered['privacy.core'],enforcement:'unverified',
      }),
      capture:Object.freeze({
        m3AdapterRegistered:registered['memory.events'],
        acceptedObservationObserved:'unverified',
        dialoguePersisted:'unverified',
      }),
      // Registration only. Persisted consent, budget and idle evidence are read by
      // the M7 worker itself at each tick; see memoryCloudCurationDiagnostics().
      cloud:Object.freeze({
        workerRegistered:!!runtime.cloudCuration,consent:'unverified',budget:'unverified',idle:'unverified',
      }),
    });
    return Object.freeze({capabilities:resolveMemoryKCapabilities({config,available:registered}),environment});
  };
  runtime.services.memoryKCapabilities=()=>runtime.services.memoryKDiagnostics().capabilities;
  let knowledgeContract=options.dialogueKnowledgeContract,knowledgePerceptionContract=options.perceptionContract;
  if(knowledgeContract===undefined)knowledgeContract=capabilityManifest?.dialogueKnowledgeContract;
  if(knowledgePerceptionContract===undefined)knowledgePerceptionContract=capabilityManifest?.perceptionContract;
  runtime.dialogueKnowledgeBuildSupported=dialogueKnowledgeContractSupported(knowledgeContract,knowledgePerceptionContract);
  // Keep PS4 fail-closed but disclose which *build* prerequisite is absent.
  // A live native hello or a radio catalog is not a substitute for the
  // source/hash-verified build payload.
  runtime.dialogueKnowledgeBuildFailure=runtime.dialogueKnowledgeBuildSupported?null:
    !knowledgeContract?'missing_dialogue_knowledge_contract':
    knowledgeContract.available!==true?'native_payload_unavailable':
    !perceptionContractSupported(knowledgePerceptionContract)?'perception_contract_mismatch':
    'dialogue_contract_mismatch';
  if(config.dialogueKnowledge.mode==='active'&&!runtime.dialogueKnowledgeBuildSupported) {
    try { console.warn('[PS4] Perceived knowledge unavailable ('+
      runtime.dialogueKnowledgeBuildFailure+
      '): rebuild matching native and companion payloads with npm run build:ps4.'); } catch {}
  }
  if(config.intelligence.mode==='shadow') {
    let contract=options.perceptionContract;
    if(contract===undefined) try {contract=JSON.parse(await readFile(new URL('../build-manifest.json',import.meta.url),'utf8')).perceptionContract;}catch{}
    if(perceptionContractSupported(contract)) {
      const checkpoint=owner.checkpoint();
      try {
        owner.starting('source.intelligence');
        const suppliedIntelligenceTelemetry=options.intelligenceOptions?.telemetry;
        // Radio remains optional and never supplies a second model prompt writer.
        const sourceActivation=memoryKSourceActivation(config);
        let radioCatalog=options.intelligenceOptions?.radioCatalog;
        if(sourceActivation.ps2.enabled && radioCatalog===undefined && config.intelligence.radio==='shadow') {
          try {radioCatalog=loadRadioTrackTextCatalog(await readFile(new URL('../data/radioTrackTextIds.v2.json',import.meta.url),'utf8'));} catch {}
        }
        let memoryIntake=null;
        let currentOwnerPlayerAuthority=null;
        const memoryStore=runtime.memoryPause.optionalStore(runtime.characterService?.store);
        const memoryNative=options.memoryNativeAuthority??memoryAuthorityPort;
        const canBindMemory=config.promotedCharacters.storageMode==='sqlite' &&
          typeof memoryStore?.withTimelineWrite==='function' &&
          typeof memoryNative?.resolveNativeOwner==='function';
        // Strict synchronous verified PS2 tap; never execute SQLite here.
        const memoryObservationTap=receipt=>!runtime.memoryPause.paused&&memoryIntake?.acceptedObservationTap(receipt) ||
          {accepted:false,reason:'m3_owner_ledger_unavailable'};
        const intelligenceOptions={radioCatalog,situationFor:ref=>runtime.situationFor(ref),
          directorProductionRequired:config.spontaneousSpeech.mode==='experimental',
          // Original stock A turn/mic/output stores; every missing bridge or
          // source read fails closed before native Director reserve/submit.
          originalTurnPriority:()=>{try{return runtime.host.directorTurnPrioritySnapshot();}catch{return null;}},
          originalTurnReserve:ticket=>{try{return runtime.host.directorReserveOriginalTurn(ticket);}catch{return null;}},
          originalTurnCurrent:ticket=>{try{return runtime.host.directorCheckOriginalTurn(ticket);}catch{return null;}},
          originalTurnRelease:ticket=>{try{return runtime.host.directorReleaseOriginalTurn(ticket);}catch{return false;}},
          originalTurnPhase:ticket=>{try{return runtime.host.directorOriginalPhase(ticket);}catch{return null;}},
          ...options.intelligenceOptions,
           consumers:sourceActivation,
           acceptedObservationTap:canBindMemory&&m3Activation.events.mode!=='off'?memoryObservationTap:null,
           telemetry:(event,data)=>{
          try { suppliedIntelligenceTelemetry?.(event,data); } catch {}
          try { telemetry?.emit?.(event,null,'internal',data,'internal'); } catch {}
        }};
        runtime.intelligence=new IntelligenceClient(config.intelligence,intelligenceOptions);
        owner.own('source.intelligence',runtime.intelligence,value=>value.stop());
        // EA mood does not survive world epochs, host authority changes or a
        // retired native intelligence stream. This listener cannot grant mood.
        owner.own('emotion.world',runtime.intelligence.subscribeWorldBoundary(
          ()=>runtime.emotionalMood?.clear()),unsubscribe=>unsubscribe());
        owner.own('emotion.host',runtime.intelligence.subscribeVerifiedHostContext(
          ()=>runtime.emotionalMood?.clear()),unsubscribe=>unsubscribe());
        // Independently authenticated D02 owner/controlled-player source.
        // Exposes only the synchronous read-through lease/verification port;
        // neither this port nor the native frame attests accepted dialogue.
        const dialogueEnabled=memoryKDialogueActivation(config).player;
        if(canBindMemory && !options.memoryNativeAuthority) {
          try {
            currentOwnerPlayerAuthority=createMemoryD02Port({
              intelligence:runtime.intelligence,memoryStore:runtime.characterService.store});
            runtime.memoryD02=currentOwnerPlayerAuthority.port;
            owner.own('authority.d02',currentOwnerPlayerAuthority,value=>value.close());
          }catch{owner.failed('authority.d02');currentOwnerPlayerAuthority=null;}
        }
        // D01 OpenAI acceptance receipts never outlive a verified host run or
        // world epoch: any change retires the current acceptance source run.
        if(canBindMemory&&dialogueEnabled){
          let acceptanceEpoch=null;
          owner.own('acceptance.host',runtime.intelligence.subscribeVerifiedHostContext(host=>{
            const stamp=host?host.hostRunId+':'+host.worldEpoch:null;
            if(stamp!==acceptanceEpoch){
              if(acceptanceEpoch!==null)runtime.retireOriginalAcceptanceSourceRun?.();
              acceptanceEpoch=stamp;
            }
          }),unsubscribe=>unsubscribe());
          owner.own('acceptance.boundary',runtime.intelligence.subscribeWorldBoundary(()=>{runtime.retireOriginalAcceptanceSourceRun?.();}),unsubscribe=>unsubscribe());
        }
        // One genuine authenticated ledger for M2/M3 plus the M3 PS2 intake, built
        // by the shared factory the integration tests also use. Normal production
        // never trusts a caller-supplied nativeVerified flag or model-generated
        // owner claim; an explicit test-only injected authority stays isolated.
        if(canBindMemory&&!runtime.memoryPause.paused&&(m3Activation.events.mode!=='off'||m3Activation.coverage.mode!=='off')){
          try{
            const m3=createM3ProductionMemory({intelligence:runtime.intelligence,memoryStore,
              nativeAuthority:options.memoryNativeAuthority??null,telemetry,
              eventMode:m3Activation.events.mode,coverageMode:m3Activation.coverage.mode,
              onDurableEvent:characterId=>runtime.retention?.noteEvidenceCommitted(characterId)});
            memoryIntake=m3.adapter;
            connectedMemoryAuthority=m3.authority;
            runtime.memoryM3=Object.freeze({snapshot:()=>m3.snapshot(),
              operationalStates:()=>{
                const states=m3.operationalStates(),unavailable=unavailableM3States(m3Activation);
                return Object.freeze(Object.fromEntries(['events','coverage'].map(kind=>{
                  const gate=m3Activation[kind],id='memory.'+kind;
                  return [id,gate.reason?unavailable[id]:states[id]];
                })));
              },
              close:()=>m3.adapter.close(),shutdown:()=>m3.close()});
            owner.own('memory.m3',m3,value=>value.close());
          }catch{owner.failed('memory.m3');memoryIntake=null;connectedMemoryAuthority=null;try{console.warn('[M3] verified_owner_binder_unavailable');}catch{}}
        }
        if(config.promotedCharacters.storageMode==='sqlite' && runtime.characterService?.store?.onBoundary) {
          const source=bindTrustedTimelineSource({store:runtime.characterService.store,
            intelligenceClient:runtime.intelligence,
            autoResume:config.memoryK.autoResumeSingleTimeline===true,
            onSafeFailure:()=>runtime.characterService.emit('character_safe_failure',{reason:'timeline_write_suspended'})});
          owner.own('storage.source',source,binding=>binding.close());
        }
        // M7: a changed host run/world epoch or any world boundary aborts in-flight
        // cloud work. Only a CHANGE counts; repeated samples of the same host do not.
        if(runtime.cloudCuration){
          let m7Host=null;
          owner.own('m7.host',runtime.intelligence.subscribeVerifiedHostContext(host=>{
            const stamp=host?host.hostRunId+':'+host.worldEpoch:null;
            if(stamp!==m7Host){m7Host=stamp;try{runtime.cloudCuration?.invalidate();}catch{}}
          }),unsubscribe=>unsubscribe());
          owner.own('m7.boundary',runtime.intelligence.subscribeWorldBoundary(()=>{
            try{runtime.cloudCuration?.invalidate();}catch{}
          }),unsubscribe=>unsubscribe());
        }
        runtime.intelligence.start();
      }catch{
        const cleanup=await owner.rollback(checkpoint);
        if(cleanup.failures.length) throw runtimeCleanupError(owner,cleanup.failures);
        owner.failed('source.intelligence');runtime.intelligence=null;runtime.memoryD02=null;runtime.memoryM3=null;connectedMemoryAuthority=null;
        runtime.emotionalMood?.clear();
        try{console.warn('[PS] optional_channel_unavailable');}catch{}
      }
    } else try {console.warn('[PS] optional_perception_contract_unavailable');}catch{}
  }

  // Production coordinator: original Core kb is still the only scheduler.
  // The native add-on must independently opt in and source-pin each C-06 gate.
  if(config.spontaneousSpeech.mode!=='off' && runtime.intelligence?.runtime.salience) {
    const client=runtime.intelligence;
    const now=()=>client.runtime.now();
    const experimental=config.spontaneousSpeech.mode==='experimental';
    const sourceCheck=({proposal,stamp,stage})=>{
      const live=client.runtime,owner=live.directorOwnerProofFor(proposal.speakerCaptureRef);
      const priority=live.directorPriority,at=now();
      if(!owner || !priority || !priority.experimentalEnabled ||
         !Number.isSafeInteger(at) || at-priority.receivedAt>1500 ||
         at<priority.receivedAt ||
         owner.hostRunId!==stamp.hostRunId ||
         owner.worldEpoch!==stamp.worldEpoch ||
         owner.ownerIncarnationId!==stamp.ownerIncarnationId ||
         owner.proofRevision!==stamp.proofRevision ||
         priority.hostRunId!==stamp.hostRunId ||
         priority.worldEpoch!==stamp.worldEpoch ||
         priority.playerTurnVersion!==stamp.playerTurnVersion ||
         !live.current(proposal.playerCaptureRef))return false;
      // PS3 grants expire during ordinary TTS; native verifies the original
      // bound Core tuple and current player-priority epoch at playback end.
      if(stage==='complete')return true;
      return client.directorOriginalEntitlement(proposal,stamp)?.source===
        'original_companion_ps2_ps3';
    };
    const admission=new DirectorSpeechReservations({
      now,enabled:experimental,checkCurrent:sourceCheck,
      limits:directorSpeechLimitsForPreset(config.spontaneousSpeech.preset),
      acknowledge:(decisionKey,consumer,outcome,proposal)=>
        consumer==='ps6_ticket' && outcome==='delivered' && proposal?.decisionKey===decisionKey
          ? client.runtime.salience.acknowledgeDirectorCompletion(proposal,client.runtime.epoch)
          : false,
    });
    const coordinator=new SceneDirectorSpeech({
      admission,now,mode:experimental?'active':'shadow',
      originalEntitlement:(proposal,stamp)=>client.directorOriginalEntitlement(proposal,stamp),
      nativeRequest:r=>client.requestDirector(r),
      dispatch:r=>client.dispatchDirector(r),
    });
    let pump;
    pump=new DirectorObservationPump({client,coordinator,now,
      stampFor:proposal=>pump.currentStamp(proposal),
      onDiagnostic:result=>{
        try {telemetry?.emit?.('director_gate',null,'internal',{
          reason:result.reason,configuredMode:config.spontaneousSpeech.mode,
          nativeExperimental:client.runtime.directorPriority?.experimentalEnabled===true,
        },'internal');}catch{}
      },
      onResult:outcome=>{
        try {telemetry?.emit?.('director_candidate',null,'internal',{
          status:outcome?.status??'unknown',nativeReason:outcome?.nativeReason,
          diagnosticReason:outcome?.diagnosticReason??null,
          // One-way code of the original native event signal: joins this
          // attempt to perception_trace and the native [PS] log lines.
          traceCode:outcome?.traceCode??null,urgency:outcome?.urgency??null,
          configuredMode:config.spontaneousSpeech.mode,
          executionAvailable:experimental &&
            client.runtime.directorPriority?.experimentalEnabled===true,
        },'internal');}catch{}
      },
    });
    runtime.director=pump;
    owner.own('director.pump',pump,value=>value.stop());
    runtime.services.spontaneousSpeechStatus=()=>Object.freeze({
      requested:config.spontaneousSpeech.mode,
      preset:config.spontaneousSpeech.preset,
      routineSpeakerCooldownMs:admission.limits.routineSpeakerCooldownMs,
      urgentSpeakerCooldownMs:admission.limits.urgentSpeakerCooldownMs,
      sceneGapMs:admission.limits.sceneGapMs,
      attemptsPerMinute:admission.limits.attemptsPerMinute,
      executionAvailable:experimental &&
        client.runtime.directorPriority?.experimentalEnabled===true &&
        client.runtime.directorRequestVersion===1,
      reason:experimental?'native_opt_in_and_live_C06_required':'shadow_only',
    });
    owner.own('director.subscription',client.subscribeKnowledgeInvalidation(()=>{void pump.tick();}),unsubscribe=>unsubscribe());
  }
  // Orderly shutdown revokes any still-pending OpenAI acceptance receipts.
  runtime.services.acceptPlayerTranscript = input => runtime.intelligence?.acceptPlayerTranscript(input) ?? {accepted:false,reason:'unsupported_capture_receipt'};
  runtime.services.projectTurnContext = input => runtime.intelligence?.projectTurnContext(input) ?? null;
  runtime.services.acknowledgeTurnContext = (projection,outcome='delivered') => runtime.intelligence?.acknowledgeTurnContext(projection,outcome) ?? false;
  if(config.activities.mode==='shadow' || config.activities.mode==='on') {
    const checkpoint=owner.checkpoint();
    try {
      owner.starting('activities');
      const notifyKnowledge=()=>{try{runtime.intelligence?.notifyKnowledgeInvalidation();}catch{}};
      const onEvent = (event, data) => { try { telemetry?.emit?.(event, null, 'system', data); } catch {} notifyKnowledge(); };
      const onFrame=frame=>{try{options.activityOptions?.onFrame?.(frame);}catch{}notifyKnowledge();};
      runtime.activities = config.activities.mode === 'on'
        ? new ActivityRuntime(config.activities, { ...options.activityOptions, onEvent,onFrame })
        : new ActivityClient(config.activities, { ...options.activityOptions, onEvent,onFrame });
      owner.own('activities',runtime.activities,value=>value.stop());
      runtime.activities.start();
      runtime.characterService?.bindActivities?.(runtime.activities);
    } catch {
      const cleanup=await owner.rollback(checkpoint);
      if(cleanup.failures.length) throw runtimeCleanupError(owner,cleanup.failures);
      owner.failed('activities');runtime.activities=null;
      try { console.warn('[ACT] optional_channel_unavailable'); } catch {}
    }
  }
  // Cosmetic gestures are default off and cannot veto a normal conversation.
  if (config.reactions?.mode === 'shadow' || config.reactions?.mode === 'on') {
    const checkpoint = owner.checkpoint();
    try {
      owner.starting('reactions');
      const report = (event, data) => { try { telemetry?.emit?.(event, null, 'system', data); } catch {} };
      const client = new ReactionClient(config.reactions, { ...options.reactionOptions, onEvent: report });
      runtime.services.reactions = createReactionService({ config: config.reactions, client, report });
      owner.own('reactions', client, value => value.stop());
      client.start();
    } catch {
      const cleanup = await owner.rollback(checkpoint);
      if (cleanup.failures.length) throw runtimeCleanupError(owner, cleanup.failures);
      owner.failed('reactions'); runtime.services.reactions = null;
      try { console.warn('[RX] optional_channel_unavailable'); } catch {}
    }
  }
  if (runtime.characterService) {
    // Opt-in SQLite writer must release its explicit cross-host lock at orderly shutdown.
    // No JSON default store or native effect ownership is changed.
    if (runtime.characterService.ready && options.startCharacterEditor !== false) try {
      // Per-user endpoint file for the native console bridge; null disables it.
      // The resolved environment keeps explicit test/embedding envs isolated.
      const endpointPath = options.controlEndpointPath !== undefined ? options.controlEndpointPath : defaultControlEndpointPath({ env });
      runtime.memoryInspectorControls=createInspectorControls({runtime,configPath:options.configPath,env});
      runtime.characterEditor = await startCharacterEditor(runtime.characterService,{ endpointPath,
        inspectorControls:runtime.memoryInspectorControls,
        voiceStatus:()=>runtime.voiceActivity?.snapshot()??{v:1,phase:'unavailable'},
        diagnostics:()=>({
          source:runtime.intelligence?.operationalStates?.()??null,
          owner:runtime.memoryD02?.status?.()??null,
          dialogue:runtime.services.memoryDialogueDiagnostics(),
          history:runtime.services.memoryJournalDiagnostics(),
          timeline:{writable:runtime.characterService.store.timelineWritable,
            selectionConfirmed:runtime.characterService.store.timelineSelectionConfirmed===true,
            pendingReason:runtime.characterService.store.timelinePendingReason}
        }) });
      owner.own('p2.editor',runtime.characterEditor,value=>value.close());
      try { console.info('[P2] Character editor: ' + runtime.characterEditor.url); } catch {}
      if (endpointPath && !runtime.characterEditor.endpointPublished) try { console.warn('[UX] Control endpoint file unavailable; native clients use the page handshake.'); } catch {}
    } catch { runtime.characterService.emit('character_safe_failure',{reason:'owner_unavailable'}); }
  }
  // Revoke pending issuance/connections before draining consumers/storage.
  owner.own('essential.revocation',runtime,value=>{value.retireOriginalAcceptanceSourceRun?.();value.closeConnections();});
  const beforeExit=()=>{void runtime.dispose().then(result=>{
    if(result.failures.length) console.warn('[runtime] disposal_failed',result.failures);
  });};
  process.once('beforeExit',beforeExit);
  owner.own('process.beforeExit',beforeExit,value=>process.removeListener('beforeExit',value));
  return runtime;
  } catch(error) {
    const cleanup=await owner.dispose();
    if(cleanup.failures.length) throw runtimeCleanupError(owner,
      [...new Set([...(error.failures??[]),...cleanup.failures])],'runtime_startup_cleanup_failed');
    throw error;
  }
}
