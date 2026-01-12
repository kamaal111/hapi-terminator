import type { Server, Request, ResponseToolkit, ResponseObject } from '@hapi/hapi';
import { z } from 'zod/mini';

import pkg from './package.json';

export type TerminatorOptions = z.infer<typeof TerminatorOptionsSchema>;

export const plugin = { pkg, register };

const TerminatorOptionsSchema = z.nullish(
  z.object({
    unregisteredLimit: z.union([z.nullish(z.number().check(z.minimum(0))), z.boolean()]),
  }),
);

async function register(server: Server, rawOptions: TerminatorOptions) {
  const options = TerminatorOptionsSchema.parse(rawOptions);

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

export default { plugin };
