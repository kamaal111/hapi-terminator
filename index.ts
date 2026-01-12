import type { Server, Request, ResponseToolkit, ResponseObject } from '@hapi/hapi';

import pkg from './package.json';

export type TerminatorOptions = { unregisteredLimit?: number | boolean | null };

export const plugin = { pkg, register };

async function register(server: Server, rawOptions: Record<string, unknown> | null | undefined) {
  const options = validateOptions(rawOptions);

  server.ext('onRequest', validateHookHandler(options));
}

function validateHookHandler(pluginOptions: TerminatorOptions) {
  return (request: Request, h: ResponseToolkit) => {
    const handler = validateRoute(request, h);

    const hasTransferEncoding = Boolean(request.headers['transfer-encoding']);
    const rawContentLength: string | undefined = request.headers['content-length'];
    const willProcessPayload = hasTransferEncoding || Boolean(rawContentLength);
    if (!willProcessPayload) {
      return h.continue;
    }

    const contentLength = Number.parseInt(rawContentLength || '0', 10);
    const route = request.server.match(request.method, request.path, request.info.host);
    if (route != null) {
      const maxBytes = route.settings.payload?.maxBytes;
      return handler(contentLength, maxBytes, option => {
        return h
          .response({
            error: 'Request Entity Too Large',
            message: `Payload content length greater than maximum allowed: ${option}`,
            statusCode: 413,
          })
          .code(413);
      });
    }

    return handler(contentLength, (hasTransferEncoding ? 0 : null) ?? pluginOptions?.unregisteredLimit, () => {
      return h.response({ error: 'Not Found', message: 'Not Found', statusCode: 404 }).code(404);
    });
  };
}

function validateRoute(request: Request, h: ResponseToolkit) {
  return (
    contentLength: number,
    limit: number | boolean | null | undefined,
    response: (option: number) => ResponseObject,
  ) => {
    if (limit == null) {
      return h.continue;
    }

    if (limit === false) {
      return h.continue;
    }

    if (limit === true) {
      const result = response(0).takeover();
      closeSocketsOnFinish(request);

      return result;
    }

    if (limit === 0 || contentLength > limit) {
      const result = response(limit).takeover();
      closeSocketsOnFinish(request);

      return result;
    }

    return h.continue;
  };
}

function closeSocketsOnFinish(request: Request) {
  request.raw.res.once('finish', () => {
    const socket = request.raw.req.socket;
    if (socket.destroy) {
      socket.destroy();
    } else {
      socket.end();
    }
  });
}

function validateOptions(options: Record<string, unknown> | null | undefined): TerminatorOptions {
  if (options == null) {
    return { unregisteredLimit: null };
  }

  if (!('unregisteredLimit' in options)) {
    return { unregisteredLimit: null };
  }

  const unregisteredLimit = options.unregisteredLimit;
  if (typeof unregisteredLimit === 'number') {
    return { unregisteredLimit: Math.max(0, unregisteredLimit) };
  }

  if (typeof unregisteredLimit === 'boolean') {
    return { unregisteredLimit };
  }

  return { unregisteredLimit: null };
}

export default { plugin };
