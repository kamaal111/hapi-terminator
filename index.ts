import type { Server, Request, ResponseToolkit } from '@hapi/hapi';
import Boom from '@hapi/boom';

import pkg from './package.json';

export type TerminatorOptions = {
  terminateOnRegisteredMaxBytes?: number | ((request: Request, size: number) => boolean);
  terminateOnUnregisteredMaxBytes?: number | ((request: Request, size: number) => boolean);
};

export const plugin = { pkg, register };

function handleUnregisteredRoute(request: Request, h: ResponseToolkit, options: TerminatorOptions) {
  return (contentLength: number) => {
    if (
      options.terminateOnUnregisteredMaxBytes == null ||
      (typeof options.terminateOnUnregisteredMaxBytes === 'number' && options.terminateOnUnregisteredMaxBytes < 0)
    ) {
      return h.continue;
    }

    if (
      (typeof options.terminateOnUnregisteredMaxBytes === 'number' &&
        contentLength > options.terminateOnUnregisteredMaxBytes) ||
      (typeof options.terminateOnUnregisteredMaxBytes === 'function' &&
        options.terminateOnUnregisteredMaxBytes(request, contentLength))
    ) {
      request.raw.req.socket?.destroy();
    }

    throw Boom.notFound();
  };
}

function handleRegisteredRoute(request: Request, h: ResponseToolkit, options: TerminatorOptions) {
  return (contentLength: number) => {
    if (
      options.terminateOnRegisteredMaxBytes == null ||
      (typeof options.terminateOnRegisteredMaxBytes === 'number' && options.terminateOnRegisteredMaxBytes < 0)
    ) {
      return h.continue;
    }

    if (
      (typeof options.terminateOnRegisteredMaxBytes === 'number' &&
        contentLength > options.terminateOnRegisteredMaxBytes) ||
      (typeof options.terminateOnRegisteredMaxBytes === 'function' &&
        options.terminateOnRegisteredMaxBytes(request, contentLength))
    ) {
      request.raw.req.socket?.destroy();
      throw Boom.entityTooLarge(
        typeof options.terminateOnRegisteredMaxBytes === 'number'
          ? `Payload content length greater than maximum allowed: ${options.terminateOnRegisteredMaxBytes}`
          : undefined,
      );
    }

    return h.continue;
  };
}

async function register(server: Server, options: TerminatorOptions) {
  server.ext('onRequest', async (request: Request, h) => {
    const unregisteredRouteHandler = handleUnregisteredRoute(request, h, options);
    const registeredRouteHandler = handleRegisteredRoute(request, h, options);

    const rawContentLength = request.headers['content-length'];
    if (!rawContentLength) {
      return h.continue;
    }

    const contentLength = Number.parseInt(rawContentLength, 10);
    if (Number.isNaN(contentLength)) {
      return h.continue;
    }

    const matchedRoute = request.server.match(request.method, request.path);
    if (matchedRoute != null) {
      return registeredRouteHandler(contentLength);
    }

    return unregisteredRouteHandler(contentLength);
  });
}
