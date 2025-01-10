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
export declare class RetryError extends Error {
    attempts: number;
    lastError: Error;
    constructor(attempts: number, lastError: Error);
}
export declare class TimeoutError extends Error {
    constructor(operationName: string, timeout: number);
}
type LifecycleFn<T> = (payload: T) => any | Promise<any>;
/**
 * Orchestrates complex operations with lifecycle management, parallel execution,
 * retry logic, and timeout handling.
 */
export declare class Orchestrator<TContext extends Record<string, any> = any> {
    private onProcessBeginCb;
    private onProcessCompletionCb;
    private onTaskBeginCb;
    private onTaskCompletionCb;
    private uid;
    private context;
    onProcessBegin(fn: LifecycleFn<OnProcessBeginPayload>): this;
    onProcessCompletion(fn: LifecycleFn<OnProcessCompletionPayload>): this;
    onTaskBegin(fn: LifecycleFn<OnTaskBeginPayload>): this;
    onTaskCompletion(fn: LifecycleFn<OnTaskCompletionPayload>): this;
    setState<K extends keyof TContext>(key: K, value: TContext[K]): this;
    getState(): OrchestrationContext<TContext>;
    private executeWithRetry;
    action<T extends unknown[], R>(originalFn: (...args: T) => R | Promise<R>, options?: StepOptions): (...args: T) => Promise<R>;
    parallel<R>(operations: Array<(...args: any[]) => Promise<R>>, options?: ParallelOptions): (...args: any[]) => Promise<R[]>;
    run<T>(executionContext: () => T | Promise<T>): Promise<T>;
}
export {};
//# sourceMappingURL=Orchestrator.d.ts.map