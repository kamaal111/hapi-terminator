# hapi-terminator

A Hapi plugin that terminates requests with payloads that exceed a specified size limit. This plugin helps protect your server from excessively large payloads by gracefully ending the socket connection before the entire payload is processed.

## Features

- 🛡️ Protects against large payload attacks
- 🔀 Different limits for registered vs unregistered routes
- 🎯 Per-route limit configuration
- ⚡ Terminates connections early to save resources
- 📦 TypeScript support included

## Installation

```bash
npm install hapi-terminator
```

or with other package managers:

```bash
yarn add hapi-terminator
bun add hapi-terminator
pnpm add hapi-terminator
```

## Usage

### Basic Example

```typescript
import Hapi from '@hapi/hapi';
import terminatorPlugin, { type TerminatorOptions } from 'hapi-terminator';

const server = Hapi.server({ port: 3000, host: '127.0.0.1' });

const requestTerminateOptions: TerminatorOptions = {
  unregisteredLimit: 500 * 1024, // 500KB for unregistered routes
};

await server.register({
  plugin: terminatorPlugin,
  options: requestTerminateOptions,
});

server.route({
  method: ['POST'],
  path: '/',
  handler: () => 'Hello World!',
  options: {
    payload: {
      maxBytes: 500 * 1024, // 500KB limit for this route
    },
  },
});

await server.start();
console.log('Server running on %s', server.info.uri);
```

### Per-Route Limits

You can set limits for specific routes using Hapi's native `payload.maxBytes` configuration:

```typescript
import Hapi from '@hapi/hapi';
import terminatorPlugin, { type TerminatorOptions } from 'hapi-terminator';

const server = Hapi.server({ port: 3000, host: '127.0.0.1' });

await server.register({
  plugin: terminatorPlugin,
  options: {
    unregisteredLimit: 100 * 1024, // 100KB for unregistered routes
  },
});

server.route({
  method: ['GET', 'POST'],
  path: '/',
  handler: () => 'Hello World!',
});

// Upload route with higher limit (10MB)
server.route({
  method: ['POST'],
  path: '/upload',
  handler: () => ({ success: true }),
  options: {
    payload: {
      maxBytes: 10 * 1024 * 1024, // 10MB
    },
  },
});

await server.start();
```

### Boolean Limits for Unregistered Routes

You can use boolean values for `unregisteredLimit` to control unregistered route behavior:

```typescript
import Hapi from '@hapi/hapi';
import terminatorPlugin, { type TerminatorOptions } from 'hapi-terminator';

const server = Hapi.server({ port: 3000, host: '127.0.0.1' });

// Reject all unregistered routes immediately
await server.register({
  plugin: terminatorPlugin,
  options: {
    unregisteredLimit: true, // Immediately reject all unregistered routes
  },
});

// This route will work normally
server.route({
  method: ['POST'],
  path: '/api/data',
  handler: () => ({ success: true }),
  options: {
    payload: {
      maxBytes: 1024 * 1024, // 1MB
    },
  },
});

// Any request to unregistered routes (e.g., /unknown) will be rejected immediately
await server.start();
```

You can also set `unregisteredLimit` to `false` to bypass payload size checks for unregistered routes:

```typescript
await server.register({
  plugin: terminatorPlugin,
  options: {
    unregisteredLimit: false, // Bypass payload size checks for unregistered routes
  },
});
```

## Configuration

### TerminatorOptions

| Option              | Type                | Description                                                                                                                                                                                                   |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unregisteredLimit` | `number \| boolean` | Maximum payload size in bytes for unregistered routes. Must be >= 0. Set to `null` or `undefined` to disable. Set to `true` to reject all requests immediately. Set to `false` to bypass payload size checks. |

### Route Payload Configuration

Use Hapi's native `payload.maxBytes` option in your route configuration to set per-route limits:

Use Hapi's native `payload.maxBytes` option in your route configuration to set per-route limits:

```typescript
server.route({
  method: 'POST',
  path: '/upload',
  handler: () => ({ success: true }),
  options: {
    payload: {
      maxBytes: 10 * 1024 * 1024, // 10MB
    },
  },
});
```

### Behavior

- **Registered Routes**: Routes use Hapi's native `payload.maxBytes` setting. When a payload exceeds this limit, the socket is gracefully ended and a `413 Payload Too Large` error is returned.
- **Unregistered Routes**: When a payload exceeds the `unregisteredLimit`, the socket is gracefully ended and a `404 Not Found` error is returned.
- **Per-Route Limits**: Use Hapi's `payload.maxBytes` to customize limits for individual routes.
- **Disabled**: Omit `payload.maxBytes` to allow unlimited payload size for a route.
- **Boolean Values for Unregistered Routes**:
  - Set `unregisteredLimit` to `true` to immediately reject all unregistered route requests regardless of Content-Length (even 0 bytes).
  - Set `unregisteredLimit` to `false` to bypass payload size checks for unregistered route requests (they will still receive 404 responses).

## How It Works

The plugin hooks into Hapi's `onRequest` extension point and checks the `Content-Length` header of incoming requests. If the content length exceeds the configured threshold:

1. An appropriate error response is returned (413 for registered routes, 404 for unregistered routes)
2. The socket connection is gracefully ended after the response is sent
3. No further processing occurs, saving server resources

## License

MIT

## Author

Kamaal Farah
