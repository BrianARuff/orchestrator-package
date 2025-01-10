"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const Orchestrator_1 = require("../Orchestrator");
/**
 * A small helper to simulate random async delays (up to `ms`).
 */
function randomDelay(ms = 100) {
    const delay = Math.floor(Math.random() * ms);
    return new Promise((resolve) => setTimeout(resolve, delay));
}
(0, globals_1.describe)('Orchestrator', () => {
    let orchestrator;
    (0, globals_1.beforeEach)(() => {
        orchestrator = new Orchestrator_1.Orchestrator();
        // Suppress error logs in tests
        console.error = jest.fn();
    });
    (0, globals_1.it)('tracks timing of synchronous operations accurately', async () => {
        const log = [];
        let totalDuration = 0;
        orchestrator
            .onProcessBegin(({ time, context }) => {
            log.push('onProcessBegin');
            (0, globals_1.expect)(context.startTime).toEqual(time);
            (0, globals_1.expect)(typeof time).toBe('number');
        })
            .onTaskBegin(({ name, startTime, context }) => {
            log.push(`onTaskBegin:${name}`);
            (0, globals_1.expect)(context.operations.length).toBeGreaterThanOrEqual(1);
            (0, globals_1.expect)(typeof startTime).toBe('number');
        })
            .onTaskCompletion(({ name, endTime, duration, context }) => {
            log.push(`onTaskCompletion:${name}`);
            (0, globals_1.expect)(typeof endTime).toBe('number');
            (0, globals_1.expect)(duration).toBeGreaterThanOrEqual(0);
            (0, globals_1.expect)(context.operations.find((s) => s.name === name)).toBeTruthy();
        })
            .onProcessCompletion(({ time, totalDuration: td, context }) => {
            log.push('onProcessCompletion');
            (0, globals_1.expect)(typeof time).toBe('number');
            (0, globals_1.expect)(td).toBeGreaterThanOrEqual(0);
            (0, globals_1.expect)(context.endTime).toBe(time);
            totalDuration = td; // fix variable assignment
        });
        const stepSync1 = orchestrator.action(() => {
            log.push('sync1');
        });
        const stepSync2 = orchestrator.action(() => {
            log.push('sync2');
        });
        await orchestrator.run(async () => {
            await stepSync1();
            await stepSync2();
        });
        (0, globals_1.expect)(log).toEqual([
            'onProcessBegin',
            'onTaskBegin:anonymous',
            'sync1',
            'onTaskCompletion:anonymous',
            'onTaskBegin:anonymous',
            'sync2',
            'onTaskCompletion:anonymous',
            'onProcessCompletion'
        ]);
        const context = orchestrator.getState();
        (0, globals_1.expect)(context.operations.length).toBe(2);
        (0, globals_1.expect)(totalDuration).toBeGreaterThanOrEqual(0);
    });
    (0, globals_1.it)('measures duration of asynchronous operations correctly', async () => {
        const logs = [];
        orchestrator.onTaskBegin(({ name }) => logs.push(`start:${name}`));
        orchestrator.onTaskCompletion(({ name, duration }) => {
            logs.push(`end:${name}`);
            (0, globals_1.expect)(duration).toBeGreaterThan(0);
        });
        const stepAsync = orchestrator.action(async () => {
            logs.push('asyncTask started');
            await new Promise((resolve) => setTimeout(resolve, 50));
            logs.push('asyncTask finished');
            return 'AsyncResult';
        });
        let result;
        await orchestrator.run(async () => {
            result = await stepAsync();
        });
        (0, globals_1.expect)(result).toBe('AsyncResult');
        (0, globals_1.expect)(orchestrator.getState().operations.length).toBe(1);
        (0, globals_1.expect)(logs).toEqual([
            'start:anonymous',
            'asyncTask started',
            'asyncTask finished',
            'end:anonymous'
        ]);
    });
    (0, globals_1.it)('properly waits for mixed sync & async steps in sequence', async () => {
        const events = [];
        orchestrator
            .onProcessBegin(() => events.push('onProcessBegin'))
            .onTaskBegin(({ name }) => events.push(`onTaskBegin:${name}`))
            .onTaskCompletion(({ name, duration }) => {
            events.push(`onTaskCompletion:${name}, dur=${duration}`);
        })
            .onProcessCompletion(() => events.push('onProcessCompletion'));
        const stepSync = orchestrator.action(() => {
            events.push('sync1 done');
            return 123;
        });
        const stepAsync = orchestrator.action(async () => {
            events.push('async1 started');
            await new Promise((resolve) => setTimeout(resolve, 30));
            events.push('async1 done');
            return 456;
        });
        const stepSync2 = orchestrator.action(() => {
            events.push('sync2 done');
        });
        await orchestrator.run(async () => {
            const r1 = await stepSync();
            const r2 = await stepAsync();
            (0, globals_1.expect)(r1).toBe(123);
            (0, globals_1.expect)(r2).toBe(456);
            await stepSync2();
        });
        (0, globals_1.expect)(orchestrator.getState().operations.length).toBe(3);
        (0, globals_1.expect)(events).toEqual([
            'onProcessBegin',
            'onTaskBegin:anonymous',
            'sync1 done',
            globals_1.expect.stringMatching(/^onTaskCompletion:anonymous, dur=\d+$/),
            'onTaskBegin:anonymous',
            'async1 started',
            'async1 done',
            globals_1.expect.stringMatching(/^onTaskCompletion:anonymous, dur=\d+$/),
            'onTaskBegin:anonymous',
            'sync2 done',
            globals_1.expect.stringMatching(/^onTaskCompletion:anonymous, dur=\d+$/),
            'onProcessCompletion'
        ]);
    });
    (0, globals_1.it)('captures errors in synchronous tasks and still calls onTaskCompletion', async () => {
        const errorLogs = [];
        orchestrator
            .onTaskBegin(({ name }) => errorLogs.push(`taskBegin:${name}`))
            .onTaskCompletion(({ name }) => errorLogs.push(`taskCompletion:${name}`))
            .onProcessCompletion(() => errorLogs.push(`onProcessCompletion`));
        const stepThatThrows = orchestrator.action(() => {
            errorLogs.push('throwNow');
            throw new Error('sync error');
        });
        let caughtError = null;
        await orchestrator
            .run(async () => {
            try {
                await stepThatThrows();
            }
            catch (err) {
                caughtError = err;
                errorLogs.push('caughtSyncError');
            }
        })
            .catch((e) => {
            errorLogs.push('runRejected');
        });
        (0, globals_1.expect)(caughtError).not.toBeNull();
        (0, globals_1.expect)(caughtError?.message).toBe('sync error');
        (0, globals_1.expect)(errorLogs).toEqual([
            'taskBegin:anonymous',
            'throwNow',
            'taskCompletion:anonymous',
            'caughtSyncError',
            'onProcessCompletion'
        ]);
        (0, globals_1.expect)(orchestrator.getState().operations.length).toBe(1);
        const step = orchestrator.getState().operations[0];
        (0, globals_1.expect)(step.endTime).not.toBeNull();
        (0, globals_1.expect)(step.duration).toBeGreaterThanOrEqual(0);
    });
    (0, globals_1.it)('captures errors in async tasks and still calls onTaskCompletion', async () => {
        const logs = [];
        orchestrator
            .onTaskBegin(({ name }) => logs.push(`taskBegin:${name}`))
            .onTaskCompletion(({ name }) => logs.push(`taskCompletion:${name}`))
            .onProcessCompletion(() => logs.push('onProcessCompletion'));
        const stepReject = orchestrator.action(async () => {
            logs.push('stepReject started');
            await new Promise((_, reject) => setTimeout(() => reject(new Error('async fail')), 20));
        });
        let caughtError = null;
        await orchestrator
            .run(async () => {
            try {
                await stepReject();
            }
            catch (err) {
                caughtError = err;
                logs.push('caughtAsyncError');
            }
        })
            .catch(() => {
            logs.push('runRejected');
        });
        (0, globals_1.expect)(caughtError?.message).toBe('async fail');
        (0, globals_1.expect)(logs).toEqual([
            'taskBegin:anonymous',
            'stepReject started',
            'taskCompletion:anonymous',
            'caughtAsyncError',
            'onProcessCompletion'
        ]);
        const ctx = orchestrator.getState();
        (0, globals_1.expect)(ctx.operations.length).toBe(1);
        (0, globals_1.expect)(ctx.operations[0].endTime).not.toBeNull();
        (0, globals_1.expect)(ctx.operations[0].duration).toBeGreaterThanOrEqual(0);
    });
    (0, globals_1.it)('allows us to store and mutate custom context data across lifecycle hooks', async () => {
        orchestrator.setState('userId', 12345);
        orchestrator
            .onProcessBegin(({ context }) => {
            context.sessionId = 'abc-session';
            context.count = 0;
        })
            .onTaskBegin(({ context }) => {
            context.count = (context.count || 0) + 1;
        })
            .onTaskCompletion(({ context }) => {
            context.count = (context.count || 0) + 1;
        })
            .onProcessCompletion(({ context }) => {
            (0, globals_1.expect)(context.userId).toBe(12345);
            (0, globals_1.expect)(context.sessionId).toBe('abc-session');
            (0, globals_1.expect)(context.count).toBe(4);
        });
        const step1 = orchestrator.action(() => 'step1');
        const step2 = orchestrator.action(async () => {
            await randomDelay(50);
            return 'step2';
        });
        await orchestrator.run(async () => {
            await step1();
            await step2();
        });
    });
    (0, globals_1.it)('handles a complex mixture of sync, async, context usage, and partial errors', async () => {
        const bigLog = [];
        orchestrator
            .onProcessBegin(() => bigLog.push('onProcessBegin complexFlow'))
            .onTaskBegin(({ name }) => {
            bigLog.push(`start:${name}`);
        })
            .onTaskCompletion(({ name, duration }) => {
            bigLog.push(`end:${name}, dur=${duration}`);
        })
            .onProcessCompletion(({ context }) => {
            bigLog.push('onProcessCompletion complexFlow');
            (0, globals_1.expect)(context.operations.length).toBe(4);
        });
        const stepSyncOk = orchestrator.action(() => {
            bigLog.push('syncOk done');
        });
        const stepSyncThrow = orchestrator.action(() => {
            bigLog.push('syncThrow => throwing now');
            throw new Error('syncProblem');
        });
        const stepAsyncOk = orchestrator.action(async () => {
            bigLog.push('asyncOk => started');
            await randomDelay(100);
            bigLog.push('asyncOk => done');
        });
        const stepAsyncReject = orchestrator.action(async () => {
            bigLog.push('asyncReject => started');
            await randomDelay(100);
            throw new Error('asyncRejection');
        });
        let syncError = null;
        let asyncError = null;
        await orchestrator.run(async () => {
            await stepSyncOk();
            try {
                await stepSyncThrow();
            }
            catch (err) {
                syncError = err;
                bigLog.push('caughtSyncError in run');
            }
            await stepAsyncOk();
            try {
                await stepAsyncReject();
            }
            catch (err) {
                asyncError = err;
                bigLog.push('caughtAsyncError in run');
            }
        });
        (0, globals_1.expect)(syncError?.message).toBe('syncProblem');
        (0, globals_1.expect)(asyncError?.message).toBe('asyncRejection');
        (0, globals_1.expect)(bigLog[0]).toBe('onProcessBegin complexFlow');
        (0, globals_1.expect)(bigLog.includes('caughtSyncError in run')).toBe(true);
        (0, globals_1.expect)(bigLog.includes('caughtAsyncError in run')).toBe(true);
        (0, globals_1.expect)(bigLog.at(-1)).toBe('onProcessCompletion complexFlow');
    });
    (0, globals_1.it)('verifies complex custom context manipulation across different step phases', async () => {
        const logs = [];
        orchestrator
            .onProcessBegin(({ context }) => {
            context.customVal = 10;
            context.extraFlag = false;
            logs.push('onProcessBegin: set customVal=10, extraFlag=false');
        })
            .onTaskBegin(({ context, name }) => {
            if (name === 'syncStep') {
                context.customVal += 2;
                logs.push(`onTaskBegin sync: customVal => ${context.customVal}`);
            }
            else {
                context.customVal += 3;
                logs.push(`onTaskBegin async: customVal => ${context.customVal}`);
            }
        })
            .onTaskCompletion(({ context, name }) => {
            if (name === 'syncStep') {
                context.extraFlag = true;
                logs.push(`onTaskCompletion sync: extraFlag => ${context.extraFlag}`);
            }
            else {
                context.customVal += 1;
                logs.push(`onTaskCompletion async: customVal => ${context.customVal}`);
            }
        })
            .onProcessCompletion(({ context }) => {
            logs.push(`onProcessCompletion: customVal=${context.customVal}, extraFlag=${context.extraFlag}`);
            (0, globals_1.expect)(context.customVal).toBe(18);
            (0, globals_1.expect)(context.extraFlag).toBe(true);
        });
        const syncStep = orchestrator.action(function syncStep() {
            logs.push('sync step invoked');
        });
        const asyncStep = orchestrator.action(async function asyncStep() {
            logs.push('async step start');
            await new Promise((r) => setTimeout(r, 20));
            logs.push('async step done');
        });
        await orchestrator.run(async () => {
            await syncStep();
            await asyncStep();
            await syncStep();
        });
        (0, globals_1.expect)(logs).toContain('onProcessBegin: set customVal=10, extraFlag=false');
        (0, globals_1.expect)(logs).toContain('onTaskBegin sync: customVal => 12');
        (0, globals_1.expect)(logs).toContain('onTaskCompletion sync: extraFlag => true');
        (0, globals_1.expect)(logs).toContain('onTaskBegin async: customVal => 15');
        (0, globals_1.expect)(logs).toContain('onTaskCompletion async: customVal => 16');
        (0, globals_1.expect)(logs.at(-1)).toMatch(/^onProcessCompletion: customVal=18.*$/);
    });
    (0, globals_1.it)('runs steps in parallel and maintains timing/context', async () => {
        const logs = [];
        const timings = [];
        orchestrator
            .onTaskBegin(({ name }) => {
            logs.push(`start:${name}`);
            timings.push(Date.now());
        })
            .onTaskCompletion(({ name, duration }) => {
            logs.push(`end:${name}`);
            timings.push(Date.now());
        });
        const step1 = orchestrator.action(async () => {
            logs.push('step1 running');
            await new Promise(r => setTimeout(r, 50));
            return 1;
        });
        const step2 = orchestrator.action(async () => {
            logs.push('step2 running');
            await new Promise(r => setTimeout(r, 30));
            return 2;
        });
        const parallelSteps = orchestrator.parallel([step1, step2]);
        const results = await orchestrator.run(async () => {
            return await parallelSteps();
        });
        (0, globals_1.expect)(logs).toContain('step1 running');
        (0, globals_1.expect)(logs).toContain('step2 running');
        const totalDuration = timings[timings.length - 1] - timings[0];
        (0, globals_1.expect)(totalDuration).toBeLessThan(80);
        (0, globals_1.expect)(orchestrator.getState().operations.length).toBe(2);
    });
    (0, globals_1.it)('handles errors in parallel steps with failFast option', async () => {
        const logs = [];
        const successStep = orchestrator.action(async () => {
            logs.push('success running');
            await new Promise(r => setTimeout(r, 50));
            return 'ok';
        });
        const failStep = orchestrator.action(async () => {
            logs.push('fail running');
            throw new Error('parallel failure');
        });
        const parallelSteps = orchestrator.parallel([successStep, failStep], { failFast: true });
        await (0, globals_1.expect)(orchestrator.run(() => parallelSteps()))
            .rejects
            .toThrow('parallel failure');
        (0, globals_1.expect)(logs).toContain('fail running');
    });
    (0, globals_1.it)('handles real-world API parallel calls with rate limiting', async () => {
        const rateLimitMs = 100;
        const apiCalls = new Set();
        const maxConcurrent = 3;
        function checkRateLimit() {
            if (apiCalls.size >= maxConcurrent) {
                throw new Error('Rate limit exceeded');
            }
        }
        const mockApiCall = orchestrator.action(async (id) => {
            checkRateLimit();
            apiCalls.add(id);
            await randomDelay(rateLimitMs);
            apiCalls.delete(id);
            return `response-${id}`;
        });
        const calls = Array.from({ length: 5 }, (_, i) => () => mockApiCall(i + 1));
        const batchSize = maxConcurrent;
        const results = [];
        await orchestrator.run(async () => {
            for (let i = 0; i < calls.length; i += batchSize) {
                const batch = calls.slice(i, i + batchSize);
                const batchResults = await orchestrator.parallel(batch)();
                results.push(...batchResults);
            }
        });
        (0, globals_1.expect)(results).toHaveLength(5);
        (0, globals_1.expect)(results).toEqual([
            'response-1',
            'response-2',
            'response-3',
            'response-4',
            'response-5'
        ]);
    });
    (0, globals_1.it)('simulates complex data processing pipeline with parallel steps', async () => {
        const logs = [];
        const data = Array.from({ length: 4 }, (_, i) => ({
            id: i + 1,
            value: Math.random() * 100
        }));
        const processChunk = orchestrator.action(async (chunk) => {
            logs.push(`Processing chunk ${chunk.id}`);
            await randomDelay(20);
            return { ...chunk, processed: true };
        });
        const enrichChunk = orchestrator.action(async (chunk) => {
            logs.push(`Enriching chunk ${chunk.id}`);
            await randomDelay(30);
            return { ...chunk, enriched: { extra: chunk.value * 2 } };
        });
        const validateChunk = orchestrator.action(async (chunk) => {
            logs.push(`Validating chunk ${chunk.id}`);
            await randomDelay(10);
            if (chunk.value > 90) {
                throw new Error(`Validation failed for chunk ${chunk.id}`);
            }
            return { ...chunk, validated: true };
        });
        let processedData = [];
        await orchestrator.run(async () => {
            const processed = await orchestrator.parallel(data.map(chunk => () => processChunk(chunk)))();
            const enriched = await orchestrator.parallel(processed.map(chunk => () => enrichChunk(chunk)))();
            const validated = await Promise.allSettled(enriched.map(chunk => validateChunk(chunk)));
            processedData = validated.map(result => result.status === 'fulfilled' ? result.value : result.reason);
        });
        (0, globals_1.expect)(processedData.length).toBe(data.length);
        (0, globals_1.expect)(logs.filter(l => l.startsWith('Processing'))).toHaveLength(data.length);
        (0, globals_1.expect)(logs.filter(l => l.startsWith('Enriching'))).toHaveLength(data.length);
        (0, globals_1.expect)(logs.filter(l => l.startsWith('Validating'))).toHaveLength(data.length);
        processedData.forEach(chunk => {
            if (!(chunk instanceof Error) && chunk.value <= 90) {
                (0, globals_1.expect)(chunk.processed).toBe(true);
                (0, globals_1.expect)(chunk.enriched).toBeDefined();
                (0, globals_1.expect)(chunk.validated).toBe(true);
            }
        });
    });
    (0, globals_1.it)('handles parallel steps with shared resources and locking', async () => {
        const sharedResource = {
            value: 0,
            lock: false,
            async acquire() {
                while (this.lock) {
                    await new Promise(r => setTimeout(r, 10));
                }
                this.lock = true;
            },
            release() {
                this.lock = false;
            }
        };
        const updateResource = orchestrator.action(async (increment) => {
            await sharedResource.acquire();
            const current = sharedResource.value;
            await randomDelay(20);
            sharedResource.value = current + increment;
            sharedResource.release();
            return sharedResource.value;
        });
        const operations = [10, 20, 30, -5].map(inc => () => updateResource(inc));
        await orchestrator.run(async () => {
            await orchestrator.parallel(operations)();
        });
        (0, globals_1.expect)(sharedResource.value).toBe(55);
        (0, globals_1.expect)(sharedResource.lock).toBe(false);
    });
    (0, globals_1.it)('handles step timeouts correctly', async () => {
        const logs = [];
        const slowStep = orchestrator.action(async () => {
            logs.push('slow step start');
            await new Promise(resolve => setTimeout(resolve, 500));
            logs.push('slow step end');
            return 'done';
        }, { timeout: 100 });
        const fastStep = orchestrator.action(async () => {
            logs.push('fast step start');
            await new Promise(resolve => setTimeout(resolve, 50));
            logs.push('fast step end');
            return 'quick';
        }, { timeout: 100 });
        await orchestrator.run(async () => {
            const fastResult = await fastStep();
            (0, globals_1.expect)(fastResult).toBe('quick');
        });
        // Expect slowStep to timeout
        await (0, globals_1.expect)(orchestrator.run(() => slowStep()))
            .rejects
            .toThrow('Step "anonymous" timed out after 100ms');
        (0, globals_1.expect)(logs).toContain('fast step start');
        (0, globals_1.expect)(logs).toContain('fast step end');
        (0, globals_1.expect)(logs).toContain('slow step start');
        (0, globals_1.expect)(logs).not.toContain('slow step end');
        const context = orchestrator.getState();
        (0, globals_1.expect)(context.operations).toHaveLength(2);
        context.operations.forEach(step => {
            (0, globals_1.expect)(step.endTime).not.toBeNull();
            (0, globals_1.expect)(step.duration).toBeDefined();
        });
    });
    (0, globals_1.it)('ensures cleanup runs even when operations time out', async () => {
        const mockDb = {
            isConnected: false,
            cleanup: jest.fn()
        };
        const connectDb = orchestrator.action(async () => {
            mockDb.isConnected = true;
            return 'connected';
        });
        const longQuery = orchestrator.action(async () => {
            if (!mockDb.isConnected)
                throw new Error('No connection');
            await new Promise(resolve => setTimeout(resolve, 200));
            return 'query result';
        }, { timeout: 100 });
        const cleanup = orchestrator.action(async () => {
            mockDb.cleanup();
            mockDb.isConnected = false;
        });
        await orchestrator.run(async () => {
            try {
                await connectDb();
                await longQuery();
            }
            catch (err) {
                (0, globals_1.expect)(err.name).toBe('TimeoutError');
            }
            finally {
                await cleanup();
            }
        });
        (0, globals_1.expect)(mockDb.cleanup).toHaveBeenCalled();
        (0, globals_1.expect)(mockDb.isConnected).toBe(false);
    });
    (0, globals_1.it)('prevents cascading failures using circuit breaker pattern', async () => {
        const breaker = {
            failures: 0,
            lastFailure: null,
            state: 'closed'
        };
        const FAILURE_THRESHOLD = 3;
        const RESET_TIMEOUT = 200;
        const checkCircuit = () => {
            const now = Date.now();
            if (breaker.state === 'open') {
                if (now - (breaker.lastFailure ?? 0) > RESET_TIMEOUT) {
                    breaker.state = 'half-open';
                }
                else {
                    throw new Error('Circuit breaker open');
                }
            }
        };
        const unreliableService = orchestrator.action(async (shouldSucceed) => {
            checkCircuit();
            if (!shouldSucceed) {
                breaker.failures++;
                breaker.lastFailure = Date.now();
                if (breaker.failures >= FAILURE_THRESHOLD) {
                    breaker.state = 'open';
                }
                throw new Error('Service error');
            }
            if (breaker.state === 'half-open') {
                breaker.state = 'closed';
                breaker.failures = 0;
            }
            return 'success';
        }, {
            retry: {
                attempts: 5,
                backoff: 100,
                exponential: true
            }
        });
        // Trigger failures to open the circuit
        for (let i = 0; i < FAILURE_THRESHOLD; i++) {
            await (0, globals_1.expect)(orchestrator.run(() => unreliableService(false)))
                .rejects
                .toThrow('Service error');
        }
        (0, globals_1.expect)(breaker.state).toBe('open');
        await new Promise(r => setTimeout(r, RESET_TIMEOUT));
        // Attempt a successful call to half-open the circuit
        await orchestrator.run(async () => {
            const result = await unreliableService(true);
            (0, globals_1.expect)(result).toBe('success');
            (0, globals_1.expect)(breaker.state).toBe('closed');
        });
    });
    (0, globals_1.it)('handles complex retry scenarios with cleanup and resource management', async () => {
        const resources = new Map();
        const locks = new Set();
        const acquireResource = async (id) => {
            if (locks.has(id))
                throw new Error('Resource locked');
            locks.add(id);
            return () => locks.delete(id);
        };
        const processWithRetry = orchestrator.action(async (id, data) => {
            const release = await acquireResource(id);
            try {
                if (!resources.has(id)) {
                    resources.set(id, { id, isLocked: false, data: null });
                }
                const resource = resources.get(id);
                if (resource.isLocked) {
                    throw new Error('Resource busy');
                }
                resource.isLocked = true;
                await new Promise(r => setTimeout(r, 50));
                resource.data = data;
                resource.isLocked = false;
                return true;
            }
            finally {
                release();
            }
        }, {
            retry: {
                attempts: 3,
                backoff: 100,
                exponential: true
            }
        });
        await orchestrator.run(async () => {
            const operations = [
                { id: 'res1', data: 'data1' },
                { id: 'res1', data: 'data2' },
                { id: 'res2', data: 'data3' }
            ];
            const results = await Promise.allSettled(operations.map(op => processWithRetry(op.id, op.data)));
            const succeeded = results.filter(r => r.status === 'fulfilled');
            (0, globals_1.expect)(succeeded.length).toBeGreaterThanOrEqual(2);
            (0, globals_1.expect)(locks.size).toBe(0);
            (0, globals_1.expect)(resources.get('res1')?.isLocked).toBe(false);
            (0, globals_1.expect)(resources.get('res2')?.isLocked).toBe(false);
        });
    });
    (0, globals_1.it)('maintains consistent state during document processing pipeline', async () => {
        const orchestrator = new Orchestrator_1.Orchestrator();
        const stateSnapshots = [];
        // Initialize state
        orchestrator.setState('documentsProcessed', 0);
        orchestrator.setState('currentBatch', []);
        orchestrator.setState('processingErrors', []);
        orchestrator.setState('isBatchProcessing', false);
        // Capture state at each lifecycle point
        orchestrator
            .onProcessBegin(({ context }) => {
            context.startTime = Date.now();
            stateSnapshots.push({ ...context });
        })
            .onTaskBegin(({ context }) => {
            context.isBatchProcessing = true;
            stateSnapshots.push({ ...context });
        })
            .onTaskCompletion(({ context }) => {
            context.isBatchProcessing = false;
            stateSnapshots.push({ ...context });
        })
            .onProcessCompletion(({ context }) => {
            context.endTime = Date.now();
            stateSnapshots.push({ ...context });
        });
        const processBatch = orchestrator.action(async (documents) => {
            const state = orchestrator.getState();
            state.currentBatch = documents;
            await randomDelay(50); // Simulate processing time
            state.documentsProcessed += documents.length;
            state.currentBatch = [];
            return documents.map(doc => `processed_${doc}`);
        });
        const documentBatches = [
            ['doc1', 'doc2'],
            ['doc3', 'doc4'],
            ['doc5']
        ];
        await orchestrator.run(async () => {
            for (const batch of documentBatches) {
                await processBatch(batch);
            }
        });
        // Verify state transitions
        (0, globals_1.expect)(stateSnapshots).toHaveLength(8); // 1 start + 3 batches * 2 events + 1 end
        // Initial state
        (0, globals_1.expect)(stateSnapshots[0].documentsProcessed).toBe(0);
        (0, globals_1.expect)(stateSnapshots[0].isBatchProcessing).toBe(false);
        // During first batch
        (0, globals_1.expect)(stateSnapshots[1].isBatchProcessing).toBe(true);
        (0, globals_1.expect)(stateSnapshots[1].currentBatch).toEqual([]);
        // After all processing
        const finalState = stateSnapshots[stateSnapshots.length - 1];
        (0, globals_1.expect)(finalState.documentsProcessed).toBe(5);
        (0, globals_1.expect)(finalState.currentBatch).toEqual([]);
        (0, globals_1.expect)(finalState.isBatchProcessing).toBe(false);
        (0, globals_1.expect)(finalState.endTime).toBeGreaterThan(finalState.startTime);
    });
    (0, globals_1.it)('handles financial transaction processing with proper state management', async () => {
        const orchestrator = new Orchestrator_1.Orchestrator();
        const stateHistory = [];
        // Setup initial state
        orchestrator.setState('balance', 1000);
        orchestrator.setState('pendingTransactions', 0);
        orchestrator.setState('processedTransactions', 0);
        orchestrator.setState('isProcessing', false);
        orchestrator
            .onProcessBegin(({ context }) => {
            stateHistory.push({ ...context });
        })
            .onTaskBegin(({ context, name }) => {
            const state = context;
            state.isProcessing = true;
            state.pendingTransactions++;
            stateHistory.push({ ...state });
        })
            .onTaskCompletion(({ context, name }) => {
            const state = context;
            state.isProcessing = false;
            state.pendingTransactions--;
            state.processedTransactions++;
            state.lastTransactionTime = Date.now();
            stateHistory.push({ ...state });
        });
        const processTransaction = orchestrator.action(async (amount) => {
            const state = orchestrator.getState();
            // Simulate transaction validation
            await randomDelay(20);
            // Check for insufficient funds BEFORE modifying balance
            if (amount < 0 && Math.abs(amount) > state.balance) {
                throw new Error('Insufficient funds');
            }
            // Modify balance only on successful transaction
            state.balance += amount;
            return state.balance;
        });
        const transactions = [100, -50, 75, -200, 50];
        await orchestrator.run(async () => {
            for (const amount of transactions) {
                try {
                    await processTransaction(amount);
                }
                catch (error) {
                    // Transaction failed, balance remains unchanged
                    if (error instanceof Error && error.message === 'Insufficient funds') {
                        // Optionally, handle the error (e.g., log it)
                    }
                    else {
                        throw error; // Re-throw unexpected errors
                    }
                }
            }
        });
        // Adjust the expected balance based on transaction logic
        // Starting balance: 1000
        // +100 = 1100
        // -50 = 1050
        // +75 = 1125
        // -200 = 1125 - 200 = 925 (should succeed)
        // +50 = 975
        // Final expected balance: 975
        const finalState = orchestrator.getState();
        (0, globals_1.expect)(finalState.pendingTransactions).toBe(0);
        (0, globals_1.expect)(finalState.processedTransactions).toBe(transactions.length);
        (0, globals_1.expect)(finalState.balance).toBe(975); // Updated expectation based on transaction logic
    });
    (0, globals_1.it)('manages state during concurrent API request handling', async () => {
        const orchestrator = new Orchestrator_1.Orchestrator();
        const stateCheckpoints = [];
        // Initialize API state
        orchestrator.setState('activeRequests', new Set());
        orchestrator.setState('completedRequests', []);
        orchestrator.setState('errorCount', 0);
        orchestrator.setState('isHealthy', true);
        let maxConcurrent = 0;
        orchestrator
            .onProcessBegin(({ context }) => {
            stateCheckpoints.push({ ...context, activeRequests: new Set(context.activeRequests) });
        })
            .onTaskBegin(({ context, name }) => {
            const state = context;
            state.activeRequests.add(name);
            if (state.activeRequests.size > maxConcurrent) {
                maxConcurrent = state.activeRequests.size;
            }
            stateCheckpoints.push({ ...state, activeRequests: new Set(state.activeRequests) });
        })
            .onTaskCompletion(({ context, name }) => {
            const state = context;
            state.activeRequests.delete(name);
            state.completedRequests.push(name);
            stateCheckpoints.push({ ...state, activeRequests: new Set(state.activeRequests) });
        });
        const makeRequest = (endpoint, shouldFail = false) => {
            // Create a unique named function for each endpoint
            const uniqueName = `request_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`;
            return orchestrator.action({
                [uniqueName]: async function () {
                    await randomDelay(50);
                    if (shouldFail) {
                        const state = orchestrator.getState();
                        state.errorCount++;
                        state.lastError = new Error(`Failed request to ${endpoint}`);
                        state.isHealthy = state.errorCount < 3;
                        throw state.lastError;
                    }
                    return { endpoint, status: 'success' };
                }
            }[uniqueName], { timeout: 1000 });
        };
        const endpoints = [
            makeRequest('/api/users'),
            makeRequest('/api/posts', true),
            makeRequest('/api/comments'),
            makeRequest('/api/auth', true)
        ];
        await orchestrator.run(async () => {
            const requests = endpoints.map(endpoint => endpoint);
            await Promise.all(requests.map(req => req().catch(() => { })));
        });
        // Final state verification
        const finalState = orchestrator.getState();
        (0, globals_1.expect)(finalState.activeRequests.size).toBe(0);
        (0, globals_1.expect)(finalState.completedRequests.length).toBe(4);
        (0, globals_1.expect)(finalState.errorCount).toBe(2);
        (0, globals_1.expect)(finalState.isHealthy).toBe(true);
        // Verify state consistency
        stateCheckpoints.forEach((state, index) => {
            if (index > 0) {
                const prevState = stateCheckpoints[index - 1];
                // Active requests should only change by 1 at a time
                (0, globals_1.expect)(Math.abs(state.activeRequests.size - prevState.activeRequests.size)).toBeLessThanOrEqual(1);
            }
        });
    });
});
//# sourceMappingURL=Orchestrator.test.js.map