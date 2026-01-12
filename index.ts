import assert from 'node:assert';

import type { Server, Request, ResponseToolkit, RequestRoute, ResponseObject } from '@hapi/hapi';
import { z } from 'zod/mini';

import pkg from './package.json';

type LimitOptionName = (typeof LIMIT_OPTION_NAMES)[keyof typeof LIMIT_OPTION_NAMES];

export type TerminatorOptions = z.infer<typeof TerminatorOptionsSchema>;

const LIMIT_OPTION_NAMES = {
  REGISTERED: 'registeredLimit',
  UNREGISTERED: 'unregisteredLimit',
} as const;

const PACKAGE_NAME = 'hapi-terminator';
assert(PACKAGE_NAME === pkg.name);

export const plugin = { pkg, register };

const TerminatorOptionsSchema = z.nullish(
  z.object({
    registeredLimit: z.nullish(z.number().check(z.minimum(0))),
    unregisteredLimit: z.union([z.nullish(z.number().check(z.minimum(0))), z.boolean()]),
  }),
);

async function register(server: Server, rawOptions: TerminatorOptions) {
  const options = TerminatorOptionsSchema.parse(rawOptions);

  server.ext('onRequest', validateHookHandler(options));
}

function validateHookHandler(pluginOptions: TerminatorOptions) {
  return (request: Request, h: ResponseToolkit) => {
    const handler = validateRoute(request, h, pluginOptions);

    const rawContentLength = request.headers['content-length'];
    if (!rawContentLength) {
      return h.continue;
    }

    const contentLength = Number.parseInt(rawContentLength, 10);
    if (Number.isNaN(contentLength)) {
      return h.continue;
    }

    const route = getRoute(request);
    if (route != null) {
      const maxBytes = route.settings.payload?.maxBytes;
      return handler(contentLength, LIMIT_OPTION_NAMES.REGISTERED, maxBytes, option => {
        return h
          .response({
            error: 'Request Entity Too Large',
            message: `Payload content length greater than maximum allowed: ${option}`,
            statusCode: 413,
          })
          .code(413);
      });
    }

    return handler(contentLength, LIMIT_OPTION_NAMES.UNREGISTERED, null, () => {
      return h.response({ error: 'Not Found', message: 'Not Found', statusCode: 404 }).code(404);
    });
  };
}

function getRoute(request: Request): RequestRoute | null {
  return request.server.match(request.method, request.path, request.info.host);
}

function validateRoute(request: Request, h: ResponseToolkit, options: TerminatorOptions) {
  return (
    contentLength: number,
    optionName: LimitOptionName,
    maxBytes: number | null | undefined,
    response: (option: number) => ResponseObject,
  ) => {
    const option = options?.[optionName];
    const limit = maxBytes ?? option;
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

    if (contentLength <= limit) {
      return h.continue;
    }

    const result = response(limit).takeover();
    closeSocketsOnFinish(request);

    return result;
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

export default { plugin };
