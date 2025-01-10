# Orchestrator

Welcome to the Orchestrator NPM package! This library helps you coordinate complex tasks by providing:
- Lifecycle hooks (begin and completion) for the overall process.
- Hooks around individual tasks (start and completion).
- Easy parallel execution with optional fail-fast mode.
- Retry logic and timeout handling for each step.

## Why Use Orchestrator?

If you need to run multiple operations (like API requests, data transformations, or file uploads) in a predictable way, Orchestrator simplifies managing them. It's good for:
- Automated workflows that contain both synchronous and asynchronous steps.
- Complex pipelines needing parallel tasks and error handling.
- Integrating retry and timeout strategies without complicating your own code.

## Orchestrator Flow & Concepts

An Orchestrator lets you define a series of actions (sync or async) that can be run or retried later. With its lifecycle events, you can observe each stage (start, end, errors) while updating a shared context. For example, you might track user data, send logs to external services, or clean up resources along the way. This makes it easier to create well-structured workflows because everything is grouped under a single, trackable process.

## Installation

```bash
npm install orchestrator
```

## Quick Example: Inventory Check & Team Notification

```typescript
import { Orchestrator } from 'orchestrator';

const orchestrator = new Orchestrator();

const checkInventory = orchestrator.action(async (sku: string) => {
  console.log(`Checking inventory for SKU: ${sku}`);
  // ...lookup stock in DB...
  return { sku, inStock: true };
});

const notifyTeam = orchestrator.action(async (sku: string) => {
  console.log(`Notifying team about low stock for SKU: ${sku}`);
  // ...send Slack or email alert...
  return true;
});

async function main() {
  await orchestrator.run(async () => {
    const result = await checkInventory('ABC123');
    if (!result.inStock) {
      await notifyTeam('ABC123');
    }
  });
}

main();
```

In this example:
1. We create an `Orchestrator` instance to manage inventory checks.
2. We define actions to “checkInventory” and “notifyTeam”.
3. We run them in a controlled way to decide if notifications are necessary.

## Basic Lifecycle Hooks Example

Below is a simple illustration showing how to set up callbacks for process and task events. The `name` parameter in these callbacks refers to the function name of the action being executed (or 'anonymous' if the function is unnamed):

```typescript
import { Orchestrator } from 'orchestrator';

const orchestrator = new Orchestrator();

orchestrator
  .onProcessBegin(({ time }) => {
    console.log('Process started at', time);
  })
  .onTaskBegin(({ name, startTime }) => {
    console.log(`Task ${name} started at ${startTime}`);
  })
  .onTaskCompletion(({ name, duration }) => {
    console.log(`Task ${name} completed in ${duration}ms`);
  })
  .onProcessCompletion(({ totalDuration }) => {
    console.log(`Process completed in ${totalDuration}ms`);
  });

const stepA = orchestrator.action(() => {
  // ...some synchronous work...
});

const stepB = orchestrator.action(async () => {
  // ...some asynchronous work...
});

await orchestrator.run(async () => {
  await stepA();
  await stepB();
});
```

Process & Task Flow Diagram:
```
┌─────────────────── Process ──────────────────┐
│                                             │
│  onProcessBegin()                           │
│  ┌─────── Task A ───────┐                   │
│  │ onTaskBegin()        │                   │
│  │ (sync work...)       │                   │
│  │ onTaskCompletion()   │                   │
│  └─────────────────────┘                    │
│  ┌─────── Task B ───────┐                   │
│  │ onTaskBegin()        │                   │
│  │ (async work...)      │                   │
│  │ onTaskCompletion()   │                   │
│  └─────────────────────┘                    │
│  onProcessCompletion()                      │
│                                             │
└─────────────────────────────────────────────┘
```

These callbacks give you visibility into the timing and flow of your operations.

## Parallel Example: Fetch User Profile & Shipping Options

```typescript
import { Orchestrator } from 'orchestrator';

const orchestrator = new Orchestrator();

const getUserProfile = orchestrator.action(async (userId: string) => {
  console.log(`Fetching profile for user ${userId}...`);
  // ...call user service...
  return { userId, name: 'Alice' };
});

const getShippingOptions = orchestrator.action(async (destination: string) => {
  console.log(`Fetching shipping options for ${destination}...`);
  // ...call shipping provider...
  return ['Standard', 'Express', 'Overnight'];
});

// Run them in parallel
const parallelTasks = orchestrator.parallel([getUserProfile, getShippingOptions]);

await orchestrator.run(async () => {
  const [profile, shippingMethods] = await parallelTasks('user42', 'USA');
  console.log('Results:', profile, shippingMethods);
});
```

Parallel Execution Flow:
```
┌─────────────────── Process ──────────────────┐
│                                             │
│  ┌─── User Profile ────┐                    │
│  │    (executing)      │                    │
│  └──────────┬─────────┘                     │
│             │                               │
│  ┌─── Shipping Opts ───┐                    │
│  │    (executing)      │                    │
│  └──────────┬─────────┘                     │
│             │                               │
│  Wait for all complete                      │
│             │                               │
│  [Results Available]                        │
│                                             │
└─────────────────────────────────────────────┘
```

Here, we retrieve user data and shipping options at the same time. If one fails and `failFast` is set, the entire parallel section will stop for quick error handling.

## Advanced Lifecycle Example: API Integration with Context

Here's how to use lifecycle hooks to manage API calls while maintaining state. Notice how we can track each action by its function name:

```typescript
import { Orchestrator } from 'orchestrator';

interface ProcessContext {
  requestCount: number;
  errors: Error[];
  apiKey?: string;
  sessionData?: Record<string, unknown>;
}

const orchestrator = new Orchestrator<ProcessContext>();

// Initialize context
orchestrator
  .setState('requestCount', 0)
  .setState('errors', [])
  .onProcessBegin(async ({ context }) => {
    // Set up API authentication
    const apiKey = await fetchApiKey();
    context.apiKey = apiKey;
    console.log('Process started with API key');
  })
  .onTaskBegin(({ name, context }) => {
    // 'name' will be 'fetchUserData' or 'updateProfile' based on the function names below
    context.requestCount++;
    console.log(`Starting ${name}, request #${context.requestCount}`);
  })
  .onTaskCompletion(({ name, context }) => {
    // Track completion of specific named operations
    console.log(`Completed ${name}, total requests: ${context.requestCount}`);
  })
  .onProcessCompletion(async ({ context }) => {
    // Clean up and log metrics
    await logMetrics({
      requests: context.requestCount,
      errors: context.errors.length
    });
    context.apiKey = undefined; // Clear sensitive data
  });

// Define named API operations - these names will appear in the lifecycle hooks
const fetchUserData = orchestrator.action(async function fetchUserData(userId: string) {
  // Function name will be available as 'fetchUserData' in hooks
  const context = orchestrator.getState();
  const response = await fetch('/api/users/' + userId, {
    headers: { 'Authorization': `Bearer ${context.apiKey}` }
  });
  
  if (!response.ok) {
    const error = new Error('Failed to fetch user');
    context.errors.push(error);
    throw error;
  }
  
  return response.json();
});

const updateProfile = orchestrator.action(async function updateProfile(userId: string, data: unknown) {
  // Function name will be available as 'updateProfile' in hooks
  const context = orchestrator.getState();
  context.sessionData = { lastUpdate: new Date() };
  
  return fetch('/api/users/' + userId, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${context.apiKey}` },
    body: JSON.stringify(data)
  });
});

// Use the orchestrated operations
await orchestrator.run(async () => {
  try {
    const userData = await fetchUserData('user123');
    await updateProfile('user123', { ...userData, lastLogin: new Date() });
  } catch (err) {
    // Error already tracked in context.errors
    console.error('Operation failed:', err);
  }
  
  const finalState = orchestrator.getState();
  console.log(`Process completed with ${finalState.errors.length} errors`);
});
```

Advanced Context & External Services Flow:
```
┌─────────────── Process Context ────────────┐
│                                           │
│ ┌─────────────┐    ┌─────────────┐       │
│ │ requestCount│    │   errors    │       │
│ └─────────────┘    └─────────────┘       │
│                                           │
│ ┌─────────────┐    ┌─────────────┐       │
│ │   apiKey    │    │ sessionData │       │
│ └─────────────┘    └─────────────┘       │
└───────────────────────────────────────────┘
           │               │
           ▼               ▼
    ┌──────────────┐  ┌──────────┐
    │  API Calls   │  │ Metrics  │
    └──────────────┘  └──────────┘

Process Flow with Context:
┌─────────── Process ──────────┐
│ 1. Begin → Get API Key       │
│ │                           │
│ │   ┌─── Task ───┐          │
│ │   │increment   │          │
│ └──►│count, call │          │
│     │API, handle │          │
│     │errors     │          │
│     └───────────┘          │
│                           │
│ Finally: Log & Cleanup    │
└───────────────────────────┘
```

This example shows how to:
1. Maintain shared state across multiple API calls
2. Track error conditions in context
3. Handle authentication setup/teardown
4. Log metrics at process completion
5. Clean up sensitive data
