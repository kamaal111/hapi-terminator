import type { Server, Request, ResponseToolkit } from '@hapi/hapi';
import Boom from '@hapi/boom';

import pkg from './package.json';

export type TerminatorOptions = {
  registeredLimit?: number | ((request: Request, size: number) => boolean);
  unregisteredLimit?: number | ((request: Request, size: number) => boolean);
};

export const plugin = { pkg, register };

async function register(server: Server, options: TerminatorOptions) {
  server.ext('onRequest', onRequest(options));
}

function onRequest(options: TerminatorOptions) {
  return (request: Request, h: ResponseToolkit) => {
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
  };
}

function handleUnregisteredRoute(request: Request, h: ResponseToolkit, options: TerminatorOptions) {
  return (contentLength: number) => {
    if (
      options.unregisteredLimit == null ||
      (typeof options.unregisteredLimit === 'number' && options.unregisteredLimit < 0)
    ) {
      return h.continue;
    }

    if (
      (typeof options.unregisteredLimit === 'number' && contentLength > options.unregisteredLimit) ||
      (typeof options.unregisteredLimit === 'function' && options.unregisteredLimit(request, contentLength))
    ) {
      request.raw.req.socket?.destroy();
      throw Boom.notFound();
    }

    return h.continue;
  };
}

function handleRegisteredRoute(request: Request, h: ResponseToolkit, options: TerminatorOptions) {
  return (contentLength: number) => {
    if (
      options.registeredLimit == null ||
      (typeof options.registeredLimit === 'number' && options.registeredLimit < 0)
    ) {
      return h.continue;
    }

    if (
      (typeof options.registeredLimit === 'number' && contentLength > options.registeredLimit) ||
      (typeof options.registeredLimit === 'function' && options.registeredLimit(request, contentLength))
    ) {
      request.raw.req.socket?.destroy();
      throw Boom.entityTooLarge(
        typeof options.registeredLimit === 'number'
          ? `Payload content length greater than maximum allowed: ${options.registeredLimit}`
          : undefined,
      );
    }

    return h.continue;
  };
}

export default { plugin };
