import assert from 'node:assert';

import type { Server, Request, ResponseToolkit, RequestRoute } from '@hapi/hapi';
import Boom from '@hapi/boom';
import { z } from 'zod/mini';

import pkg from './package.json';

type LimitOptionName = (typeof LIMIT_OPTION_NAMES)[keyof typeof LIMIT_OPTION_NAMES];

export type TerminatorRouteOptions = z.infer<typeof TerminatorRouteOptionsSchema>;

export type TerminatorOptions = z.infer<typeof TerminatorOptionsSchema>;

const LIMIT_OPTION_NAMES = {
  REGISTERED: 'registeredLimit',
  UNREGISTERED: 'unregisteredLimit',
} as const;

const PACKAGE_NAME = 'hapi-terminator';
assert(PACKAGE_NAME === pkg.name);

export const plugin = { pkg, register };

const LimitOptionShape = z.nullish(z.number().check(z.minimum(0)));

const TerminatorRouteOptionsSchema = z.nullish(z.object({ [PACKAGE_NAME]: z.object({ limit: LimitOptionShape }) }));

const TerminatorOptionsSchema = z.nullish(
  z.object({ registeredLimit: LimitOptionShape, unregisteredLimit: LimitOptionShape }),
);

async function register(server: Server, rawOptions: TerminatorOptions) {
  const options = TerminatorOptionsSchema.parse(rawOptions);
  const routeOptionsCache = new Map<string, TerminatorRouteOptions>();

  server.ext('onRequest', validateHookHandler(options, routeOptionsCache));
}

function validateHookHandler(pluginOptions: TerminatorOptions, routeOptionsCache: Map<string, TerminatorRouteOptions>) {
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

    const { route, options } = getRouteAndOptions(request, routeOptionsCache) ?? {};
    if (route != null) {
      return handler(contentLength, LIMIT_OPTION_NAMES.REGISTERED, options, option => {
        throw Boom.entityTooLarge(`Payload content length greater than maximum allowed: ${option}`);
      });
    }

    assert(options == null, "Unregistered routes can't have route options");

    return handler(contentLength, LIMIT_OPTION_NAMES.UNREGISTERED, null, () => {
      throw Boom.notFound();
    });
  };
}

function getRouteAndOptions(
  request: Request,
  routeOptionsCache: Map<string, TerminatorRouteOptions>,
): { route: RequestRoute; options: TerminatorRouteOptions } | null {
  const matchedRoute = request.server.match(request.method, request.path);
  if (matchedRoute == null) {
    return null;
  }

  const cacheKey = `${matchedRoute.method}-${matchedRoute.path}`;
  const cachedResult = routeOptionsCache.get(cacheKey);
  if (cachedResult != null) {
    return { options: cachedResult, route: matchedRoute };
  }

  const options = getRoutePluginSettings(matchedRoute);
  routeOptionsCache.set(cacheKey, options);

  return { options, route: matchedRoute };
}

function validateRoute(request: Request, h: ResponseToolkit, options: TerminatorOptions) {
  return (
    contentLength: number,
    optionName: LimitOptionName,
    routeOptions: TerminatorRouteOptions,
    throwError: (option: number) => never,
  ) => {
    const option = options?.[optionName];
    const limit = routeOptions?.[PACKAGE_NAME]?.limit ?? option;
    if (limit == null) {
      return h.continue;
    }

    if (contentLength > limit) {
      request.raw.req.socket?.destroy();
      throwError(limit);
    }

    return h.continue;
  };
}

function getRoutePluginSettings(matchedRoute: RequestRoute | null): TerminatorRouteOptions {
  return TerminatorRouteOptionsSchema.safeParse(matchedRoute?.settings.plugins).data;
}

export default { plugin };
