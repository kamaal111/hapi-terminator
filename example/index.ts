import Hapi, { type PluginSpecificConfiguration } from '@hapi/hapi';
import terminatorPlugin, { type TerminatorOptions, type TerminatorRouteOptions } from 'hapi-terminator';

type RoutePluginOptions = PluginSpecificConfiguration & TerminatorRouteOptions;

process.on('unhandledRejection', err => {
  console.log(err);
  process.exit(1);
});

const server = Hapi.server({ port: 3000, host: '127.0.0.1' });

const requestTerminateOptions: TerminatorOptions = {
  unregisteredLimit: 500 * 1024, // 500KB - destroy socket for larger payloads on unregistered routes
  registeredLimit: 500 * 1024, // 500KB - destroy socket for larger payloads on registered routes
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
  options: { plugins: { 'hapi-terminator': { limit: 1000 * 1024 } } as RoutePluginOptions },
});

server.route({
  method: ['GET', 'POST'],
  path: '/{id}',
  handler: request => `Hello ${request.params.id}!`,
});

await server.start();
console.log('Server running on %s', server.info.uri);
