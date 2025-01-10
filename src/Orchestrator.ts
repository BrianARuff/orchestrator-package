import UniqueIdGenerator from './UniqueIdGenerator';

/**
 * Describes metadata for a single operation within the orchestration.
 */
export interface OperationInfo {
  name: string;
  startTime: number;
  endTime: number | null;
  args: unknown[];
  duration?: number;
}

/**
 * Represents the orchestration state and execution context.
 */
export type OrchestrationContext<T extends Record<string, any> = Record<string, any>> = {
  id: string;
  startTime: number | null;
  endTime: number | null;
  operations: OperationInfo[];
} & T;

export interface OnProcessBeginPayload {
  time: number;
  context: OrchestrationContext;
}

export interface OnProcessCompletionPayload {
  time: number;
  totalDuration: number;
  context: OrchestrationContext;
}

export interface OnTaskBeginPayload extends OperationInfo {
  context: OrchestrationContext;
}

export interface OnTaskCompletionPayload extends OperationInfo {
  duration: number;
  context: OrchestrationContext;
}

export interface ParallelOptions {
  failFast?: boolean;
}

export interface RetryOptions {
  attempts: number;
  backoff?: number;
  exponential?: boolean;
}

export interface StepOptions {
  timeout?: number;
  retry?: RetryOptions;
}

export class RetryError extends Error {
  public attempts: number;
  public lastError: Error;

  constructor(attempts: number, lastError: Error) {
    super(`Operation failed after ${attempts} attempts. Last error: ${lastError.message}`);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export class TimeoutError extends Error {
  constructor(operationName: string, timeout: number) {
    super(`Step "${operationName}" timed out after ${timeout}ms`);
    this.name = 'TimeoutError';
  }
}

type LifecycleFn<T> = (payload: T) => any | Promise<any>;

/**
 * Orchestrates complex operations with lifecycle management, parallel execution,
 * retry logic, and timeout handling.
 */
export class Orchestrator<TContext extends Record<string, any> = any> {
  private onProcessBeginCb: LifecycleFn<OnProcessBeginPayload> | null = null;
  private onProcessCompletionCb: LifecycleFn<OnProcessCompletionPayload> | null = null;
  private onTaskBeginCb: LifecycleFn<OnTaskBeginPayload> | null = null;
  private onTaskCompletionCb: LifecycleFn<OnTaskCompletionPayload> | null = null;
  private uid = new UniqueIdGenerator().generate();

  private context: OrchestrationContext<TContext> = {
    id: this.uid,
    startTime: null,
    endTime: null,
    operations: [],
    ...({} as TContext)
  };

  public onProcessBegin(fn: LifecycleFn<OnProcessBeginPayload>): this {
    this.onProcessBeginCb = fn;
    return this;
  }

  public onProcessCompletion(fn: LifecycleFn<OnProcessCompletionPayload>): this {
    this.onProcessCompletionCb = fn;
    return this;
  }

  public onTaskBegin(fn: LifecycleFn<OnTaskBeginPayload>): this {
    this.onTaskBeginCb = fn;
    return this;
  }

  public onTaskCompletion(fn: LifecycleFn<OnTaskCompletionPayload>): this {
    this.onTaskCompletionCb = fn;
    return this;
  }

  public setState<K extends keyof TContext>(key: K, value: TContext[K]): this {
    (this.context as any)[key] = value;
    return this;
  }

  public getState(): OrchestrationContext<TContext> {
    return this.context;
  }

  private async executeWithRetry<R>(
    operationInfo: OperationInfo,
    execute: () => Promise<R>,
    options?: RetryOptions
  ): Promise<R> {
    if (!options) return execute();

    let lastError: Error;
    let attempt = 0;

    while (attempt < options.attempts) {
      try {
        if (attempt > 0 && options.backoff) {
          const delay = options.exponential
            ? options.backoff * Math.pow(2, attempt - 1)
            : options.backoff;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        return await execute();
      } catch (err) {
        lastError = err as Error;
        attempt++;
        
        console.error(
          `Operation "${operationInfo.name}" failed (attempt ${attempt}/${options.attempts}):`,
          err
        );

        if (attempt === options.attempts) {
          throw new RetryError(attempt, lastError);
        }
      }
    }

    throw new Error('Unexpected retry loop exit');
  }

  public action<T extends unknown[], R>(
    originalFn: (...args: T) => R | Promise<R>,
    options: StepOptions = {}
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      const operationInfo: OperationInfo = {
        name: originalFn.name || 'anonymous',
        startTime: Date.now(),
        endTime: null,
        args
      };
      this.context.operations.push(operationInfo);

      if (this.onTaskBeginCb) {
        await Promise.resolve(
          this.onTaskBeginCb({ ...operationInfo, context: this.context })
        );
      }

      try {
        const executeWithTimeout = async (): Promise<R> => {
          let timeoutId: NodeJS.Timeout | undefined;
          const timeoutPromise = options.timeout
            ? new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                  reject(new TimeoutError(operationInfo.name, options.timeout!));
                }, options.timeout);
              })
            : null;

          try {
            const resultPromise = Promise.resolve().then(() => originalFn(...args));
            const finalValue = await (timeoutPromise
              ? Promise.race([resultPromise, timeoutPromise])
              : resultPromise);

            if (timeoutId) clearTimeout(timeoutId);
            return finalValue as R;
          } catch (err) {
            if (timeoutId) clearTimeout(timeoutId);
            throw err;
          }
        };

        const result = await this.executeWithRetry(
          operationInfo,
          executeWithTimeout,
          options.retry
        );

        operationInfo.endTime = Date.now();
        operationInfo.duration = operationInfo.endTime - operationInfo.startTime;

        if (this.onTaskCompletionCb) {
          await Promise.resolve(
            this.onTaskCompletionCb({
              ...operationInfo,
              duration: operationInfo.duration,
              context: this.context
            })
          );
        }

        return result;
      } catch (err) {
        console.error(
          err instanceof TimeoutError
            ? `Operation timeout: ${err.message}`
            : err instanceof RetryError
            ? `Retry failed: ${err.message}`
            : 'Operation error:',
          err
        );

        operationInfo.endTime = Date.now();
        operationInfo.duration = operationInfo.endTime - operationInfo.startTime;

        if (this.onTaskCompletionCb) {
          await Promise.resolve(
            this.onTaskCompletionCb({
              ...operationInfo,
              duration: operationInfo.duration,
              context: this.context
            })
          );
        }

        throw err;
      }
    };
  }

  public parallel<R>(
    operations: Array<(...args: any[]) => Promise<R>>,
    options: ParallelOptions = {}
  ): (...args: any[]) => Promise<R[]> {
    return async (...args: any[]): Promise<R[]> => {
      // Execute all operations immediately to ensure they start concurrently
      const promises = operations.map(op => op(...args));
      
      if (options.failFast) {
        return Promise.all(promises);
      }

      // Wait for all operations to complete, regardless of success/failure
      const results = await Promise.allSettled(promises);
      
      // Process results
      const values = results.map(result => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        return result.reason;
      });

      return values;
    };
  }

  public async run<T>(executionContext: () => T | Promise<T>): Promise<T> {
    this.context.startTime = Date.now();

    if (this.onProcessBeginCb) {
      await Promise.resolve(
        this.onProcessBeginCb({
          time: this.context.startTime,
          context: this.context
        })
      );
    }

    try {
      const result = await Promise.resolve(executionContext());
      
      this.context.endTime = Date.now();

      if (this.onProcessCompletionCb) {
        await Promise.resolve(
          this.onProcessCompletionCb({
            time: this.context.endTime,
            totalDuration: this.context.endTime - (this.context.startTime ?? 0),
            context: this.context
          })
        );
      }

      return result;
    } catch (err) {
      console.error('Error in execution context:', err);
      throw err;
    }
  }
}
