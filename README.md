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
  registeredLimit: 500 * 1024, // 500KB for registered routes
};

await server.register({
  plugin: terminatorPlugin,
  options: requestTerminateOptions,
});

server.route({
  method: ['GET', 'POST'],
  path: '/',
  handler: () => 'Hello World!',
});

await server.start();
console.log('Server running on %s', server.info.uri);
```

### Per-Route Limits

You can override the global limits for specific routes by setting the limit in the route options:

```typescript
import Hapi, { type PluginSpecificConfiguration } from '@hapi/hapi';
import terminatorPlugin, { type TerminatorOptions, type TerminatorRouteOptions } from 'hapi-terminator';

type RoutePluginOptions = PluginSpecificConfiguration & TerminatorRouteOptions;

const server = Hapi.server({ port: 3000, host: '127.0.0.1' });

await server.register({
  plugin: terminatorPlugin,
  options: {
    registeredLimit: 500 * 1024, // 500KB default for registered routes
    unregisteredLimit: 100 * 1024, // 100KB for unregistered routes
  },
});

// Standard route with default limit (500KB)
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
    plugins: {
      'hapi-terminator': { limit: 10 * 1024 * 1024 }, // 10MB
    } as RoutePluginOptions,
  },
});

// Unlimited route (disable limit for this specific route)
server.route({
  method: ['POST'],
  path: '/stream',
  handler: () => ({ success: true }),
  options: {
    plugins: {
      'hapi-terminator': { limit: null }, // No limit
    } as RoutePluginOptions,
  },
});

await server.start();
```

## Configuration

### TerminatorOptions

| Option              | Type     | Description                                                                                                   |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `registeredLimit`   | `number` | Maximum payload size in bytes for registered routes. Must be >= 0. Set to `null` or `undefined` to disable.   |
| `unregisteredLimit` | `number` | Maximum payload size in bytes for unregistered routes. Must be >= 0. Set to `null` or `undefined` to disable. |

### TerminatorRouteOptions

You can configure per-route limits using the route options:

| Option  | Type     | Description                                                                                                                            |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `limit` | `number` | Maximum payload size in bytes for this specific route. Must be >= 0. Overrides the global `registeredLimit`. Set to `null` to disable. |

### Behavior

- **Registered Routes**: When a payload exceeds the limit on a registered route, the socket is gracefully ended and a `413 Payload Too Large` error is returned.
- **Unregistered Routes**: When a payload exceeds the limit on an unregistered route, the socket is gracefully ended and a `404 Not Found` error is returned.
- **Per-Route Limits**: Route-specific limits take precedence over global limits, allowing you to customize limits for individual routes.
- **Disabled**: Set to `null` or `undefined` to disable termination for that category or route.

## How It Works

The plugin hooks into Hapi's `onRequest` extension point and checks the `Content-Length` header of incoming requests. If the content length exceeds the configured threshold:

1. An appropriate error response is returned (413 for registered routes, 404 for unregistered routes)
2. The socket connection is gracefully ended after the response is sent
3. No further processing occurs, saving server resources

## License

MIT

## Author

Kamaal Farah
