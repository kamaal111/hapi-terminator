import Hapi from '@hapi/hapi';
import terminatorPlugin, { type TerminatorOptions } from 'hapi-terminator';

process.on('unhandledRejection', err => {
  console.log(err);
  process.exit(1);
});

const server = Hapi.server({ port: 3000, host: '127.0.0.1' });

const requestTerminateOptions: TerminatorOptions = {
  unregisteredLimit: 500 * 1024, // 500KB - destroy socket for larger payloads on unregistered routes
};

await server.register({
  plugin: terminatorPlugin,
  options: requestTerminateOptions,
});

server.route({
  method: ['GET'],
  path: '/',
  handler: () => 'Hello World!',
});

server.route({
  method: ['POST'],
  path: '/',
  handler: () => 'Hello World!',
  options: {
    payload: {
      maxBytes: 1000 * 1024, // 1MB - higher limit for POST
    },
  },
});

server.route({
  method: ['GET'],
  path: '/{id}',
  handler: request => `Hello ${request.params.id}!`,
});

server.route({
  method: ['POST'],
  path: '/{id}',
  handler: request => `Hello ${request.params.id}!`,
  options: {
    payload: {
      maxBytes: 500 * 1024,
    },
  },
});

await server.start();
console.log('Server running on %s', server.info.uri);
