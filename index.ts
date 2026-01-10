import type { Server, Request, ResponseToolkit } from '@hapi/hapi';
import Boom from '@hapi/boom';

import pkg from './package.json';

type LimitOption = number | ((request: Request, size: number) => boolean);

type LimitOptionName = (typeof LIMIT_OPTION_NAMES)[keyof typeof LIMIT_OPTION_NAMES];

export type TerminatorOptions = { [Name in LimitOptionName]?: LimitOption };

const LIMIT_OPTION_NAMES = {
  REGISTERED: 'registeredLimit',
  UNREGISTERED: 'unregisteredLimit',
} as const;

export const plugin = { pkg, register };

async function register(server: Server, options: TerminatorOptions) {
  server.ext('onRequest', onRequest(options));
}

function onRequest(options: TerminatorOptions) {
  return (request: Request, h: ResponseToolkit) => {
    const handler = validateRoute(request, h, options);

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
      return handler(contentLength, LIMIT_OPTION_NAMES.REGISTERED, option => {
        throw Boom.entityTooLarge(
          typeof option === 'number' ? `Payload content length greater than maximum allowed: ${option}` : undefined,
        );
      });
    }

    return handler(contentLength, LIMIT_OPTION_NAMES.UNREGISTERED, () => {
      throw Boom.notFound();
    });
  };
}

function validateRoute(request: Request, h: ResponseToolkit, options: TerminatorOptions) {
  return (contentLength: number, optionName: LimitOptionName, throwError: (option: LimitOption) => never) => {
    const option = options[optionName];
    if (option == null || (typeof option === 'number' && option < 0)) {
      return h.continue;
    }

    if (
      (typeof option === 'number' && contentLength > option) ||
      (typeof option === 'function' && option(request, contentLength))
    ) {
      request.raw.req.socket?.destroy();
      throwError(option);
    }

    return h.continue;
  };
}

export default { plugin };
