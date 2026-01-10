# hapi-terminator

A Hapi plugin that terminates requests with payloads that exceed a specified size limit. This plugin helps protect your server from excessively large payloads by destroying the socket connection before the entire payload is processed.

## Features

- 🛡️ Protects against large payload attacks
- 🔀 Different limits for registered vs unregistered routes
- 🎯 Configurable thresholds using numbers or custom functions
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
  terminateOnUnregisteredMaxBytes: 500 * 1024, // 500KB for unregistered routes
  terminateOnRegisteredMaxBytes: 500 * 1024, // 500KB for registered routes
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

### Using Custom Functions

You can provide custom functions to determine whether a request should be terminated:

```typescript
const requestTerminateOptions: TerminatorOptions = {
  terminateOnRegisteredMaxBytes: (request, size) => {
    // Custom logic based on request properties
    if (request.path === '/upload') {
      return size > 10 * 1024 * 1024; // 10MB for upload route
    }
    return size > 500 * 1024; // 500KB for other routes
  },
  terminateOnUnregisteredMaxBytes: (request, size) => {
    return size > 100 * 1024; // 100KB for unregistered routes
  },
};
```

## Configuration

### TerminatorOptions

| Option                            | Type                                                      | Description                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminateOnRegisteredMaxBytes`   | `number \| ((request: Request, size: number) => boolean)` | Maximum payload size for registered routes. Can be a number in bytes or a function that returns `true` if the request should be terminated.   |
| `terminateOnUnregisteredMaxBytes` | `number \| ((request: Request, size: number) => boolean)` | Maximum payload size for unregistered routes. Can be a number in bytes or a function that returns `true` if the request should be terminated. |

### Behavior

- **Registered Routes**: When a payload exceeds the limit on a registered route, the socket is destroyed and a `413 Payload Too Large` error is thrown.
- **Unregistered Routes**: When a payload exceeds the limit on an unregistered route, the socket is destroyed and a `404 Not Found` error is thrown.
- **Disabled**: Set to `null`, `undefined`, or a negative number to disable termination for that category.

## How It Works

The plugin hooks into Hapi's `onRequest` extension point and checks the `Content-Length` header of incoming requests. If the content length exceeds the configured threshold:

1. The socket connection is immediately destroyed
2. An appropriate error response is thrown (413 for registered routes, 404 for unregistered routes)
3. No further processing occurs, saving server resources

## License

MIT

## Author

Kamaal Farah
