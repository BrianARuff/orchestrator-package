import { describe, it, expect, beforeEach } from '@jest/globals';
import { Orchestrator } from '../Orchestrator';

/**
 * A small helper to simulate random async delays (up to `ms`).
 */
function randomDelay(ms = 100): Promise<void> {
  const delay = Math.floor(Math.random() * ms);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

interface TestContext {
  userId?: number;
  sessionId?: string;
  count?: number;
}

describe('Orchestrator', () => {
  let orchestrator: Orchestrator<TestContext>;

  beforeEach(() => {
    orchestrator = new Orchestrator<TestContext>();
    // Suppress error logs in tests
    console.error = jest.fn();
  });

  it('tracks timing of synchronous operations accurately', async () => {
    const log: string[] = [];
    let totalDuration = 0;

    orchestrator
      .onProcessBegin(({ time, context }) => {
        log.push('onProcessBegin');
        expect(context.startTime).toEqual(time);
        expect(typeof time).toBe('number');
      })
      .onTaskBegin(({ name, startTime, context }) => {
        log.push(`onTaskBegin:${name}`);
        expect(context.operations.length).toBeGreaterThanOrEqual(1);
        expect(typeof startTime).toBe('number');
      })
      .onTaskCompletion(({ name, endTime, duration, context }) => {
        log.push(`onTaskCompletion:${name}`);
        expect(typeof endTime).toBe('number');
        expect(duration).toBeGreaterThanOrEqual(0);
        expect(context.operations.find((s) => s.name === name)).toBeTruthy();
      })
      .onProcessCompletion(({ time, totalDuration: td, context }) => {
        log.push('onProcessCompletion');
        expect(typeof time).toBe('number');
        expect(td).toBeGreaterThanOrEqual(0);
        expect(context.endTime).toBe(time);
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

    expect(log).toEqual([
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
    expect(context.operations.length).toBe(2);
    expect(totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('measures duration of asynchronous operations correctly', async () => {
    const logs: string[] = [];
    orchestrator.onTaskBegin(({ name }) => logs.push(`start:${name}`));
    orchestrator.onTaskCompletion(({ name, duration }) => {
      logs.push(`end:${name}`);
      expect(duration).toBeGreaterThan(0);
    });

    const stepAsync = orchestrator.action(async () => {
      logs.push('asyncTask started');
      await new Promise((resolve) => setTimeout(resolve, 50));
      logs.push('asyncTask finished');
      return 'AsyncResult';
    });

    let result: string | undefined;

    await orchestrator.run(async () => {
      result = await stepAsync();
    });

    expect(result).toBe('AsyncResult');
    expect(orchestrator.getState().operations.length).toBe(1);

    expect(logs).toEqual([
      'start:anonymous',
      'asyncTask started',
      'asyncTask finished',
      'end:anonymous'
    ]);
  });

  it('properly waits for mixed sync & async steps in sequence', async () => {
    const events: string[] = [];

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
      expect(r1).toBe(123);
      expect(r2).toBe(456);

      await stepSync2();
    });

    expect(orchestrator.getState().operations.length).toBe(3);

    expect(events).toEqual([
      'onProcessBegin',
      'onTaskBegin:anonymous',
      'sync1 done',
      expect.stringMatching(/^onTaskCompletion:anonymous, dur=\d+$/),
      'onTaskBegin:anonymous',
      'async1 started',
      'async1 done',
      expect.stringMatching(/^onTaskCompletion:anonymous, dur=\d+$/),
      'onTaskBegin:anonymous',
      'sync2 done',
      expect.stringMatching(/^onTaskCompletion:anonymous, dur=\d+$/),
      'onProcessCompletion'
    ]);
  });

  it('captures errors in synchronous tasks and still calls onTaskCompletion', async () => {
    const errorLogs: string[] = [];
    orchestrator
      .onTaskBegin(({ name }) => errorLogs.push(`taskBegin:${name}`))
      .onTaskCompletion(({ name }) => errorLogs.push(`taskCompletion:${name}`))
      .onProcessCompletion(() => errorLogs.push(`onProcessCompletion`));

    const stepThatThrows = orchestrator.action(() => {
      errorLogs.push('throwNow');
      throw new Error('sync error');
    });

    let caughtError: Error | null = null;

    await orchestrator
      .run(async () => {
        try {
          await stepThatThrows();
        } catch (err) {
          caughtError = err as Error;
          errorLogs.push('caughtSyncError');
        }
      })
      .catch((e) => {
        errorLogs.push('runRejected');
      });

    expect(caughtError).not.toBeNull();
    expect(caughtError!?.message).toBe('sync error');

    expect(errorLogs).toEqual([
      'taskBegin:anonymous',
      'throwNow',
      'taskCompletion:anonymous',
      'caughtSyncError',
      'onProcessCompletion'
    ]);

    expect(orchestrator.getState().operations.length).toBe(1);
    const step = orchestrator.getState().operations[0];
    expect(step.endTime).not.toBeNull();
    expect(step.duration).toBeGreaterThanOrEqual(0);
  });

  it('captures errors in async tasks and still calls onTaskCompletion', async () => {
    const logs: string[] = [];

    orchestrator
      .onTaskBegin(({ name }) => logs.push(`taskBegin:${name}`))
      .onTaskCompletion(({ name }) => logs.push(`taskCompletion:${name}`))
      .onProcessCompletion(() => logs.push('onProcessCompletion'));

    const stepReject = orchestrator.action(async () => {
      logs.push('stepReject started');
      await new Promise((_, reject) => setTimeout(() => reject(new Error('async fail')), 20));
    });

    let caughtError: Error | null = null;

    await orchestrator
      .run(async () => {
        try {
          await stepReject();
        } catch (err) {
          caughtError = err as Error;
          logs.push('caughtAsyncError');
        }
      })
      .catch(() => {
        logs.push('runRejected');
      });

    expect(caughtError!?.message).toBe('async fail');

    expect(logs).toEqual([
      'taskBegin:anonymous',
      'stepReject started',
      'taskCompletion:anonymous',
      'caughtAsyncError',
      'onProcessCompletion'
    ]);

    const ctx = orchestrator.getState();
    expect(ctx.operations.length).toBe(1);
    expect(ctx.operations[0].endTime).not.toBeNull();
    expect(ctx.operations[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('allows us to store and mutate custom context data across lifecycle hooks', async () => {
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
        expect(context.userId).toBe(12345);
        expect(context.sessionId).toBe('abc-session');
        expect(context.count).toBe(4);
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

  it('handles a complex mixture of sync, async, context usage, and partial errors', async () => {
    const bigLog: string[] = [];
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
        expect(context.operations.length).toBe(4);
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

    let syncError: Error | null = null;
    let asyncError: Error | null = null;

    await orchestrator.run(async () => {
      await stepSyncOk();

      try {
        await stepSyncThrow();
      } catch (err) {
        syncError = err as Error;
        bigLog.push('caughtSyncError in run');
      }

      await stepAsyncOk();

      try {
        await stepAsyncReject();
      } catch (err) {
        asyncError = err as Error;
        bigLog.push('caughtAsyncError in run');
      }
    });

    expect(syncError!?.message).toBe('syncProblem');
    expect(asyncError!?.message).toBe('asyncRejection');

    expect(bigLog[0]).toBe('onProcessBegin complexFlow');
    expect(bigLog.includes('caughtSyncError in run')).toBe(true);
    expect(bigLog.includes('caughtAsyncError in run')).toBe(true);
    expect(bigLog.at(-1)).toBe('onProcessCompletion complexFlow');
  });

  it('verifies complex custom context manipulation across different step phases', async () => {
    const logs: string[] = [];

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
        } else {
          context.customVal += 3;
          logs.push(`onTaskBegin async: customVal => ${context.customVal}`);
        }
      })
      .onTaskCompletion(({ context, name }) => {
        if (name === 'syncStep') {
          context.extraFlag = true;
          logs.push(`onTaskCompletion sync: extraFlag => ${context.extraFlag}`);
        } else {
          context.customVal += 1;
          logs.push(`onTaskCompletion async: customVal => ${context.customVal}`);
        }
      })
      .onProcessCompletion(({ context }) => {
        logs.push(`onProcessCompletion: customVal=${context.customVal}, extraFlag=${context.extraFlag}`);
        expect(context.customVal).toBe(18);
        expect(context.extraFlag).toBe(true);
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

    expect(logs).toContain('onProcessBegin: set customVal=10, extraFlag=false');
    expect(logs).toContain('onTaskBegin sync: customVal => 12');
    expect(logs).toContain('onTaskCompletion sync: extraFlag => true');
    expect(logs).toContain('onTaskBegin async: customVal => 15');
    expect(logs).toContain('onTaskCompletion async: customVal => 16');
    expect(logs.at(-1)).toMatch(/^onProcessCompletion: customVal=18.*$/);
  });

  it('runs steps in parallel and maintains timing/context', async () => {
    const logs: string[] = [];
    const timings: number[] = [];

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

    expect(logs).toContain('step1 running');
    expect(logs).toContain('step2 running');
    
    const totalDuration = timings[timings.length - 1] - timings[0];
    expect(totalDuration).toBeLessThan(80);
    
    expect(orchestrator.getState().operations.length).toBe(2);
  });

  it('handles errors in parallel steps with failFast option', async () => {
    const logs: string[] = [];
    
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
    
    await expect(orchestrator.run(() => parallelSteps()))
      .rejects
      .toThrow('parallel failure');

    expect(logs).toContain('fail running');
  });

  it('handles real-world API parallel calls with rate limiting', async () => {
    const rateLimitMs = 100;
    const apiCalls = new Set<number>();
    const maxConcurrent = 3;

    function checkRateLimit() {
      if (apiCalls.size >= maxConcurrent) {
        throw new Error('Rate limit exceeded');
      }
    }

    const mockApiCall = orchestrator.action(async (id: number) => {
      checkRateLimit();
      apiCalls.add(id);
      await randomDelay(rateLimitMs);
      apiCalls.delete(id);
      return `response-${id}`;
    });

    const calls = Array.from({ length: 5 }, (_, i) => 
      () => mockApiCall(i + 1)
    );

    const batchSize = maxConcurrent;
    const results: string[] = [];

    await orchestrator.run(async () => {
      for (let i = 0; i < calls.length; i += batchSize) {
        const batch = calls.slice(i, i + batchSize);
        const batchResults = await orchestrator.parallel(batch)();
        results.push(...batchResults);
      }
    });

    expect(results).toHaveLength(5);
    expect(results).toEqual([
      'response-1',
      'response-2',
      'response-3',
      'response-4',
      'response-5'
    ]);
  });

  it('simulates complex data processing pipeline with parallel steps', async () => {
    interface DataChunk {
      id: number;
      value: number;
      processed?: boolean;
      enriched?: { extra: number };
      validated?: boolean;
    }

    const logs: string[] = [];
    const data: DataChunk[] = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      value: Math.random() * 100
    }));

    const processChunk = orchestrator.action(async (chunk: DataChunk) => {
      logs.push(`Processing chunk ${chunk.id}`);
      await randomDelay(20);
      return { ...chunk, processed: true };
    });

    const enrichChunk = orchestrator.action(async (chunk: DataChunk) => {
      logs.push(`Enriching chunk ${chunk.id}`);
      await randomDelay(30);
      return { ...chunk, enriched: { extra: chunk.value * 2 } };
    });

    const validateChunk = orchestrator.action(async (chunk: DataChunk) => {
      logs.push(`Validating chunk ${chunk.id}`);
      await randomDelay(10);
      if (chunk.value > 90) {
        throw new Error(`Validation failed for chunk ${chunk.id}`);
      }
      return { ...chunk, validated: true };
    });

    let processedData: DataChunk[] = [];

    await orchestrator.run(async () => {
      const processed = await orchestrator.parallel(
        data.map(chunk => () => processChunk(chunk))
      )();

      const enriched = await orchestrator.parallel(
        processed.map(chunk => () => enrichChunk(chunk))
      )();

      const validated = await Promise.allSettled(
        enriched.map(chunk => validateChunk(chunk))
      );

      processedData = validated.map(result => 
        result.status === 'fulfilled' ? result.value : result.reason
      );
    });

    expect(processedData.length).toBe(data.length);
    expect(logs.filter(l => l.startsWith('Processing'))).toHaveLength(data.length);
    expect(logs.filter(l => l.startsWith('Enriching'))).toHaveLength(data.length);
    expect(logs.filter(l => l.startsWith('Validating'))).toHaveLength(data.length);

    processedData.forEach(chunk => {
      if (!(chunk instanceof Error) && chunk.value <= 90) {
        expect(chunk.processed).toBe(true);
        expect(chunk.enriched).toBeDefined();
        expect(chunk.validated).toBe(true);
      }
    });
  });

  it('handles parallel steps with shared resources and locking', async () => {
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

    const updateResource = orchestrator.action(async (increment: number) => {
      await sharedResource.acquire();
      const current = sharedResource.value;
      await randomDelay(20);
      sharedResource.value = current + increment;
      sharedResource.release();
      return sharedResource.value;
    });

    const operations = [10, 20, 30, -5].map(
      inc => () => updateResource(inc)
    );

    await orchestrator.run(async () => {
      await orchestrator.parallel(operations)();
    });

    expect(sharedResource.value).toBe(55);
    expect(sharedResource.lock).toBe(false);
  });

  it('handles step timeouts correctly', async () => {
    const logs: string[] = [];
    
    const slowStep = orchestrator.action(
      async () => {
        logs.push('slow step start');
        await new Promise(resolve => setTimeout(resolve, 500));
        logs.push('slow step end');
        return 'done';
      },
      { timeout: 100 }
    );

    const fastStep = orchestrator.action(
      async () => {
        logs.push('fast step start');
        await new Promise(resolve => setTimeout(resolve, 50));
        logs.push('fast step end');
        return 'quick';
      },
      { timeout: 100 }
    );

    await orchestrator.run(async () => {
      const fastResult = await fastStep();
      expect(fastResult).toBe('quick');
    });

    // Expect slowStep to timeout
    await expect(orchestrator.run(() => slowStep()))
      .rejects
      .toThrow('Step "anonymous" timed out after 100ms');

    expect(logs).toContain('fast step start');
    expect(logs).toContain('fast step end');
    expect(logs).toContain('slow step start');
    expect(logs).not.toContain('slow step end');

    const context = orchestrator.getState();
    expect(context.operations).toHaveLength(2);
    context.operations.forEach(step => {
      expect(step.endTime).not.toBeNull();
      expect(step.duration).toBeDefined();
    });
  });

  it('ensures cleanup runs even when operations time out', async () => {
    interface DbConnection {
      isConnected: boolean;
      cleanup: jest.Mock;
    }

    const mockDb: DbConnection = {
      isConnected: false,
      cleanup: jest.fn()
    };

    const connectDb = orchestrator.action(async () => {
      mockDb.isConnected = true;
      return 'connected';
    });

    const longQuery = orchestrator.action(
      async () => {
        if (!mockDb.isConnected) throw new Error('No connection');
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'query result';
      },
      { timeout: 100 }
    );

    const cleanup = orchestrator.action(async () => {
      mockDb.cleanup();
      mockDb.isConnected = false;
    });

    await orchestrator.run(async () => {
      try {
        await connectDb();
        await longQuery();
      } catch (err) {
        expect((err as Record<string, unknown>).name).toBe('TimeoutError');
      } finally {
        await cleanup();
      }
    });

    expect(mockDb.cleanup).toHaveBeenCalled();
    expect(mockDb.isConnected).toBe(false);
  });

  it('prevents cascading failures using circuit breaker pattern', async () => {
    interface CircuitBreaker {
      failures: number;
      lastFailure: number | null;
      state: 'closed' | 'open' | 'half-open';
    }

    const breaker: CircuitBreaker = {
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
        } else {
          throw new Error('Circuit breaker open');
        }
      }
    };

    const unreliableService = orchestrator.action(
      async (shouldSucceed: boolean) => {
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
      },
      {
        retry: {
          attempts: 5,
          backoff: 100,
          exponential: true
        }
      }
    );

    // Trigger failures to open the circuit
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await expect(orchestrator.run(() => unreliableService(false)))
        .rejects
        .toThrow('Service error');
    }

    expect(breaker.state).toBe('open');

    await new Promise(r => setTimeout(r, RESET_TIMEOUT));

    // Attempt a successful call to half-open the circuit
    await orchestrator.run(async () => {
      const result = await unreliableService(true);
      expect(result).toBe('success');
      expect(breaker.state).toBe('closed');
    });
  });

  it('handles complex retry scenarios with cleanup and resource management', async () => {
    interface Resource {
      id: string;
      isLocked: boolean;
      data: unknown;
    }

    const resources = new Map<string, Resource>();
    const locks = new Set<string>();

    const acquireResource = async (id: string) => {
      if (locks.has(id)) throw new Error('Resource locked');
      locks.add(id);
      return () => locks.delete(id);
    };

    const processWithRetry = orchestrator.action(
      async (id: string, data: unknown) => {
        const release = await acquireResource(id);
        
        try {
          if (!resources.has(id)) {
            resources.set(id, { id, isLocked: false, data: null });
          }

          const resource = resources.get(id)!;
          
          if (resource.isLocked) {
            throw new Error('Resource busy');
          }

          resource.isLocked = true;
          await new Promise(r => setTimeout(r, 50));
          resource.data = data;
          resource.isLocked = false;
          
          return true;
        } finally {
          release();
        }
      },
      {
        retry: {
          attempts: 3,
          backoff: 100,
          exponential: true
        }
      }
    );

    await orchestrator.run(async () => {
      const operations = [
        { id: 'res1', data: 'data1' },
        { id: 'res1', data: 'data2' },
        { id: 'res2', data: 'data3' }
      ];

      const results = await Promise.allSettled(
        operations.map(op => processWithRetry(op.id, op.data))
      );

      const succeeded = results.filter(r => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(2);

      expect(locks.size).toBe(0);
      expect(resources.get('res1')?.isLocked).toBe(false);
      expect(resources.get('res2')?.isLocked).toBe(false);
    });
  });

  it('maintains consistent state during document processing pipeline', async () => {
    interface DocumentState {
      documentsProcessed: number;
      currentBatch: string[];
      processingErrors: Error[];
      startTime?: number;
      endTime?: number;
      isBatchProcessing: boolean;
    }

    const orchestrator = new Orchestrator<DocumentState>();
    const stateSnapshots: DocumentState[] = [];

    // Initialize state
    orchestrator.setState('documentsProcessed', 0);
    orchestrator.setState('currentBatch', []);
    orchestrator.setState('processingErrors', []);
    orchestrator.setState('isBatchProcessing', false);

    // Capture state at each lifecycle point
    orchestrator
      .onProcessBegin(({ context }) => {
        context.startTime = Date.now();
        stateSnapshots.push({ ...context as unknown as DocumentState });
      })
      .onTaskBegin(({ context }) => {
        context.isBatchProcessing = true;
        stateSnapshots.push({ ...context as unknown as DocumentState });
      })
      .onTaskCompletion(({ context }) => {
        context.isBatchProcessing = false;
        stateSnapshots.push({ ...context as unknown as DocumentState });
      })
      .onProcessCompletion(({ context }) => {
        context.endTime = Date.now();
        stateSnapshots.push({ ...context as unknown as DocumentState });
      });

    const processBatch = orchestrator.action(async (documents: string[]) => {
      const state = orchestrator.getState() as DocumentState;
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
    expect(stateSnapshots).toHaveLength(8); // 1 start + 3 batches * 2 events + 1 end

    // Initial state
    expect(stateSnapshots[0].documentsProcessed).toBe(0);
    expect(stateSnapshots[0].isBatchProcessing).toBe(false);

    // During first batch
    expect(stateSnapshots[1].isBatchProcessing).toBe(true);
    expect(stateSnapshots[1].currentBatch).toEqual([]);

    // After all processing
    const finalState = stateSnapshots[stateSnapshots.length - 1];
    expect(finalState.documentsProcessed).toBe(5);
    expect(finalState.currentBatch).toEqual([]);
    expect(finalState.isBatchProcessing).toBe(false);
    expect(finalState.endTime).toBeGreaterThan(finalState.startTime!);
  });

  it('handles financial transaction processing with proper state management', async () => {
    interface TransactionState {
      balance: number;
      pendingTransactions: number;
      processedTransactions: number;
      lastTransactionTime?: number;
      isProcessing: boolean;
    }

    const orchestrator = new Orchestrator<TransactionState>();
    const stateHistory: TransactionState[] = [];

    // Setup initial state
    orchestrator.setState('balance', 1000);
    orchestrator.setState('pendingTransactions', 0);
    orchestrator.setState('processedTransactions', 0);
    orchestrator.setState('isProcessing', false);

    orchestrator
      .onProcessBegin(({ context }) => {
        stateHistory.push({ ...context as unknown as TransactionState });
      })
      .onTaskBegin(({ context, name }) => {
        const state = context as unknown as TransactionState;
        state.isProcessing = true;
        state.pendingTransactions++;
        stateHistory.push({ ...state });
      })
      .onTaskCompletion(({ context, name }) => {
        const state = context as unknown as TransactionState;
        state.isProcessing = false;
        state.pendingTransactions--;
        state.processedTransactions++;
        state.lastTransactionTime = Date.now();
        stateHistory.push({ ...state });
      });

    const processTransaction = orchestrator.action(async (amount: number) => {
      const state = orchestrator.getState() as TransactionState;
      
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
        } catch (error) {
          // Transaction failed, balance remains unchanged
          if (error instanceof Error && error.message === 'Insufficient funds') {
            // Optionally, handle the error (e.g., log it)
          } else {
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

    const finalState = orchestrator.getState() as TransactionState;
    expect(finalState.pendingTransactions).toBe(0);
    expect(finalState.processedTransactions).toBe(transactions.length);
    expect(finalState.balance).toBe(975); // Updated expectation based on transaction logic
  });

  it('manages state during concurrent API request handling', async () => {
    interface ApiState {
      activeRequests: Set<string>;
      completedRequests: string[];
      errorCount: number;
      lastError?: Error;
      isHealthy: boolean;
    }

    const orchestrator = new Orchestrator<ApiState>();
    const stateCheckpoints: ApiState[] = [];

    // Initialize API state
    orchestrator.setState('activeRequests', new Set<string>());
    orchestrator.setState('completedRequests', []);
    orchestrator.setState('errorCount', 0);
    orchestrator.setState('isHealthy', true);

    let maxConcurrent = 0;

    orchestrator
      .onProcessBegin(({ context }) => {
        stateCheckpoints.push({ ...context as unknown as ApiState, activeRequests: new Set(context.activeRequests) });
      })
      .onTaskBegin(({ context, name }) => {
        const state = context as unknown as ApiState;
        state.activeRequests.add(name);
        if (state.activeRequests.size > maxConcurrent) {
          maxConcurrent = state.activeRequests.size;
        }
        stateCheckpoints.push({ ...state, activeRequests: new Set(state.activeRequests) });
      })
      .onTaskCompletion(({ context, name }) => {
        const state = context as unknown as ApiState;
        state.activeRequests.delete(name);
        state.completedRequests.push(name);
        stateCheckpoints.push({ ...state, activeRequests: new Set(state.activeRequests) });
      });

    const makeRequest = (endpoint: string, shouldFail = false) => {
      // Create a unique named function for each endpoint
      const uniqueName = `request_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`;
      return orchestrator.action(
        {
          [uniqueName]: async function() {
            await randomDelay(50);
            
            if (shouldFail) {
              const state = orchestrator.getState() as ApiState;
              state.errorCount++;
              state.lastError = new Error(`Failed request to ${endpoint}`);
              state.isHealthy = state.errorCount < 3;
              throw state.lastError;
            }
            
            return { endpoint, status: 'success' };
          }
        }[uniqueName],
        { timeout: 1000 }
      );
    };

    const endpoints = [
      makeRequest('/api/users'),
      makeRequest('/api/posts', true),
      makeRequest('/api/comments'),
      makeRequest('/api/auth', true)
    ];

    await orchestrator.run(async () => {
      const requests = endpoints.map(endpoint => endpoint);
      await Promise.all(
        requests.map(req => 
          req().catch(() => {/* swallow errors */})
        )
      );
    });

    // Final state verification
    const finalState = orchestrator.getState() as ApiState;
    expect(finalState.activeRequests.size).toBe(0);
    expect(finalState.completedRequests.length).toBe(4);
    expect(finalState.errorCount).toBe(2);
    expect(finalState.isHealthy).toBe(true);

    // Verify state consistency
    stateCheckpoints.forEach((state, index) => {
      if (index > 0) {
        const prevState = stateCheckpoints[index - 1];
        // Active requests should only change by 1 at a time
        expect(Math.abs(state.activeRequests.size - prevState.activeRequests.size)).toBeLessThanOrEqual(1);
      }
    });
  });
});
