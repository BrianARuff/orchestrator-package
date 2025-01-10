"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = exports.TimeoutError = exports.RetryError = void 0;
const UniqueIdGenerator_1 = __importDefault(require("./UniqueIdGenerator"));
class RetryError extends Error {
    constructor(attempts, lastError) {
        super(`Operation failed after ${attempts} attempts. Last error: ${lastError.message}`);
        this.name = 'RetryError';
        this.attempts = attempts;
        this.lastError = lastError;
    }
}
exports.RetryError = RetryError;
class TimeoutError extends Error {
    constructor(operationName, timeout) {
        super(`Step "${operationName}" timed out after ${timeout}ms`);
        this.name = 'TimeoutError';
    }
}
exports.TimeoutError = TimeoutError;
/**
 * Orchestrates complex operations with lifecycle management, parallel execution,
 * retry logic, and timeout handling.
 */
class Orchestrator {
    constructor() {
        this.onProcessBeginCb = null;
        this.onProcessCompletionCb = null;
        this.onTaskBeginCb = null;
        this.onTaskCompletionCb = null;
        this.uid = new UniqueIdGenerator_1.default().generate();
        this.context = {
            id: this.uid,
            startTime: null,
            endTime: null,
            operations: [],
            ...{}
        };
    }
    onProcessBegin(fn) {
        this.onProcessBeginCb = fn;
        return this;
    }
    onProcessCompletion(fn) {
        this.onProcessCompletionCb = fn;
        return this;
    }
    onTaskBegin(fn) {
        this.onTaskBeginCb = fn;
        return this;
    }
    onTaskCompletion(fn) {
        this.onTaskCompletionCb = fn;
        return this;
    }
    setState(key, value) {
        this.context[key] = value;
        return this;
    }
    getState() {
        return this.context;
    }
    async executeWithRetry(operationInfo, execute, options) {
        if (!options)
            return execute();
        let lastError;
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
            }
            catch (err) {
                lastError = err;
                attempt++;
                console.error(`Operation "${operationInfo.name}" failed (attempt ${attempt}/${options.attempts}):`, err);
                if (attempt === options.attempts) {
                    throw new RetryError(attempt, lastError);
                }
            }
        }
        throw new Error('Unexpected retry loop exit');
    }
    action(originalFn, options = {}) {
        return async (...args) => {
            const operationInfo = {
                name: originalFn.name || 'anonymous',
                startTime: Date.now(),
                endTime: null,
                args
            };
            this.context.operations.push(operationInfo);
            if (this.onTaskBeginCb) {
                await Promise.resolve(this.onTaskBeginCb({ ...operationInfo, context: this.context }));
            }
            try {
                const executeWithTimeout = async () => {
                    let timeoutId;
                    const timeoutPromise = options.timeout
                        ? new Promise((_, reject) => {
                            timeoutId = setTimeout(() => {
                                reject(new TimeoutError(operationInfo.name, options.timeout));
                            }, options.timeout);
                        })
                        : null;
                    try {
                        const resultPromise = Promise.resolve().then(() => originalFn(...args));
                        const finalValue = await (timeoutPromise
                            ? Promise.race([resultPromise, timeoutPromise])
                            : resultPromise);
                        if (timeoutId)
                            clearTimeout(timeoutId);
                        return finalValue;
                    }
                    catch (err) {
                        if (timeoutId)
                            clearTimeout(timeoutId);
                        throw err;
                    }
                };
                const result = await this.executeWithRetry(operationInfo, executeWithTimeout, options.retry);
                operationInfo.endTime = Date.now();
                operationInfo.duration = operationInfo.endTime - operationInfo.startTime;
                if (this.onTaskCompletionCb) {
                    await Promise.resolve(this.onTaskCompletionCb({
                        ...operationInfo,
                        duration: operationInfo.duration,
                        context: this.context
                    }));
                }
                return result;
            }
            catch (err) {
                console.error(err instanceof TimeoutError
                    ? `Operation timeout: ${err.message}`
                    : err instanceof RetryError
                        ? `Retry failed: ${err.message}`
                        : 'Operation error:', err);
                operationInfo.endTime = Date.now();
                operationInfo.duration = operationInfo.endTime - operationInfo.startTime;
                if (this.onTaskCompletionCb) {
                    await Promise.resolve(this.onTaskCompletionCb({
                        ...operationInfo,
                        duration: operationInfo.duration,
                        context: this.context
                    }));
                }
                throw err;
            }
        };
    }
    parallel(operations, options = {}) {
        return async (...args) => {
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
    async run(executionContext) {
        this.context.startTime = Date.now();
        if (this.onProcessBeginCb) {
            await Promise.resolve(this.onProcessBeginCb({
                time: this.context.startTime,
                context: this.context
            }));
        }
        try {
            const result = await Promise.resolve(executionContext());
            this.context.endTime = Date.now();
            if (this.onProcessCompletionCb) {
                await Promise.resolve(this.onProcessCompletionCb({
                    time: this.context.endTime,
                    totalDuration: this.context.endTime - (this.context.startTime ?? 0),
                    context: this.context
                }));
            }
            return result;
        }
        catch (err) {
            console.error('Error in execution context:', err);
            throw err;
        }
    }
}
exports.Orchestrator = Orchestrator;
//# sourceMappingURL=Orchestrator.js.map