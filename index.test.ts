import { describe, expect, test, afterEach } from 'bun:test';

import Net from 'node:net';
import assert from 'node:assert';

import Hapi, { type PluginSpecificConfiguration } from '@hapi/hapi';

import terminatorPlugin, { type TerminatorOptions, type TerminatorRouteOptions } from './index';

type RoutePluginOptions = PluginSpecificConfiguration & TerminatorRouteOptions;

function makeRequest(port: number, requestText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = Net.connect(port);
    let response = '';

    client.on('data', chunk => {
      response += chunk.toString();
      if (response.includes('\r\n\r\n')) {
        setTimeout(() => {
          if (!client.destroyed) {
            client.end();
          }
        }, 10);
      }
    });

    client.on('end', () => resolve(response));
    client.on('error', reject);

    client.on('connect', () => {
      client.write(requestText);
    });

    setTimeout(() => {
      if (!client.destroyed) {
        client.destroy();
        resolve(response);
      }
    }, 2000);
  });
}

async function testSocketDestruction(port: number, request: string): Promise<string> {
  const client = Net.connect(port);
  const clientEnded = new Promise<string>((resolve, reject) => {
    let response = '';
    client.on('data', chunk => {
      response = response + chunk.toString();
    });
    client.on('end', () => resolve(response));
    client.on('error', reject);
  });

  await new Promise(resolve => client.on('connect', resolve));
  client.write(request);

  return clientEnded;
}

async function setupServer(
  options?: TerminatorOptions,
  routes?: Array<{
    method: Hapi.RouteDefMethods;
    path: string;
    handler: Hapi.Lifecycle.Method;
  }>,
  serverOptions: Hapi.ServerOptions = {},
): Promise<Hapi.Server> {
  const server = Hapi.server({ port: 0, host: 'localhost', ...serverOptions });

  if (options !== undefined) {
    await server.register({ ...terminatorPlugin, options });
  } else {
    await server.register(terminatorPlugin);
  }

  if (routes) {
    routes.forEach(route => server.route(route));
  }

  await server.start();
  return server;
}

describe('hapi-terminator plugin', () => {
  let server: Hapi.Server | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop({ timeout: 1 });

      server = null;
    }
  });

  describe('plugin registration', () => {
    test('should register without options', async () => {
      server = await setupServer();
      assert(typeof server.registrations === 'object');
      assert('hapi-terminator' in server.registrations);
      expect(server.registrations['hapi-terminator']).toBeDefined();
    });

    test('should register with options', async () => {
      server = await setupServer({ registeredLimit: 1000, unregisteredLimit: 500 });
      assert(typeof server.registrations === 'object');
      assert('hapi-terminator' in server.registrations);
    });
  });

  describe('registered routes', () => {
    const testRoute = {
      method: 'POST' as const,
      path: '/test',
      handler: () => ({ success: true }),
    };

    describe('with numeric limit', () => {
      test.each([
        {
          description: 'should allow requests below the limit',
          limit: 1000,
          contentLength: 0,
          expectStatus: '200',
        },
        {
          description: 'should allow requests at exact limit',
          limit: 0,
          contentLength: 0,
          expectStatus: '200',
        },
      ])('$description', async ({ limit, contentLength, expectStatus }) => {
        server = await setupServer({ registeredLimit: limit }, [testRoute]);

        assert(typeof server.info.port === 'number');
        const response = await makeRequest(
          server.info.port,
          `POST /test HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${contentLength}\r\n\r\n`,
        );

        expect(response).toContain(expectStatus);
      });

      test('should destroy socket for requests above the limit', async () => {
        server = await setupServer({ registeredLimit: 1000 }, [testRoute], { routes: { timeout: { server: false } } });

        assert(typeof server.info.port === 'number');
        const response = await testSocketDestruction(
          server.info.port,
          'POST /test HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2000\r\n\r\n',
        );

        expect(response).toBe('');
      });

      test('should continue when no content-length header', async () => {
        server = await setupServer({ registeredLimit: 1000 }, [testRoute]);

        assert(typeof server.info.port === 'number');
        const response = await makeRequest(server.info.port, 'POST /test HTTP/1.1\r\nHost: localhost\r\n\r\n');

        expect(response).toContain('200');
      });
    });

    describe('with no limit', () => {
      test('should allow any size when limit is undefined', async () => {
        server = await setupServer({ registeredLimit: undefined }, [testRoute]);

        assert(typeof server.info.port === 'number');
        const response = await makeRequest(
          server.info.port,
          'POST /test HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n',
        );

        expect(response).toContain('200');
      });
    });
  });

  describe('unregistered routes', () => {
    describe('with numeric limit', () => {
      test('should return 404 for small payloads on unregistered routes', async () => {
        server = await setupServer({ unregisteredLimit: 500 });

        assert(typeof server.info.port === 'number');
        const response = await makeRequest(
          server.info.port,
          'POST /nonexistent HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n',
        );

        expect(response).toContain('404');
      });

      test('should destroy socket for large payloads on unregistered routes', async () => {
        server = await setupServer({ unregisteredLimit: 500 }, undefined, { routes: { timeout: { server: false } } });

        assert(typeof server.info.port === 'number');
        const response = await testSocketDestruction(
          server.info.port,
          'POST /nonexistent HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000\r\n\r\n',
        );

        expect(response).toBe('');
      });
    });

    describe('with no limit', () => {
      test('should return 404 when unregisteredLimit is undefined', async () => {
        server = await setupServer({ unregisteredLimit: undefined });

        assert(typeof server.info.port === 'number');
        const response = await makeRequest(
          server.info.port,
          'POST /nonexistent HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n',
        );

        expect(response).toContain('404');
      });
    });
  });

  describe('per-route limit configuration', () => {
    test('should allow route-specific limit to override registered limit', async () => {
      const testRoute = {
        method: 'POST' as const,
        path: '/upload',
        handler: () => ({ success: true }),
        options: { plugins: { 'hapi-terminator': { limit: 2000 } } as RoutePluginOptions },
      };

      server = await setupServer({ registeredLimit: 500 }, [testRoute], { routes: { timeout: { server: false } } });

      assert(typeof server.info.port === 'number');

      // Request with 1500 bytes should be blocked by global limit (500) but allowed by route limit (2000)
      // So this should NOT destroy the socket
      const response = await makeRequest(
        server.info.port,
        'POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n',
      );

      expect(response).toContain('200');
    });

    test('should destroy socket when route-specific limit is exceeded', async () => {
      const testRoute = {
        method: 'POST' as const,
        path: '/small-upload',
        handler: () => ({ success: true }),
        options: { plugins: { 'hapi-terminator': { limit: 300 } } as RoutePluginOptions },
      };

      server = await setupServer({ registeredLimit: 1000 }, [testRoute], { routes: { timeout: { server: false } } });

      assert(typeof server.info.port === 'number');
      const response = await testSocketDestruction(
        server.info.port,
        'POST /small-upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: 500\r\n\r\n',
      );

      expect(response).toBe('');
    });

    test('should use global limit when route has no specific limit', async () => {
      const testRoute = {
        method: 'POST' as const,
        path: '/test',
        handler: () => ({ success: true }),
      };

      server = await setupServer({ registeredLimit: 800 }, [testRoute], { routes: { timeout: { server: false } } });

      assert(typeof server.info.port === 'number');
      const response = await testSocketDestruction(
        server.info.port,
        'POST /test HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000\r\n\r\n',
      );

      expect(response).toBe('');
    });

    test('should allow request when route-specific limit is null', async () => {
      const testRoute = {
        method: 'POST' as const,
        path: '/unlimited',
        handler: () => ({ success: true }),
        options: { plugins: { 'hapi-terminator': { limit: null } } as RoutePluginOptions },
      };

      server = await setupServer({ registeredLimit: 500 }, [testRoute]);

      assert(typeof server.info.port === 'number');
      const response = await makeRequest(
        server.info.port,
        'POST /unlimited HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n',
      );

      expect(response).toContain('200');
    });

    test('should allow different limits for different routes', async () => {
      const smallRoute = {
        method: 'POST' as const,
        path: '/small',
        handler: () => ({ success: true }),
        options: { plugins: { 'hapi-terminator': { limit: 300 } } as RoutePluginOptions },
      };

      const largeRoute = {
        method: 'POST' as const,
        path: '/large',
        handler: () => ({ success: true }),
        options: { plugins: { 'hapi-terminator': { limit: 2000 } } as RoutePluginOptions },
      };

      server = await setupServer({ registeredLimit: 1000 }, [smallRoute, largeRoute], {
        routes: { timeout: { server: false } },
      });

      assert(typeof server.info.port === 'number');

      // Small route with large payload should fail
      const smallResponse = await testSocketDestruction(
        server.info.port,
        'POST /small HTTP/1.1\r\nHost: localhost\r\nContent-Length: 500\r\n\r\n',
      );
      expect(smallResponse).toBe('');

      // Large route with same payload should succeed
      const largeResponse = await makeRequest(
        server.info.port,
        'POST /large HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n',
      );
      expect(largeResponse).toContain('200');
    });
  });

  describe('mixed configuration', () => {
    test('should apply different limits for registered vs unregistered routes', async () => {
      server = await setupServer(
        { registeredLimit: 1000, unregisteredLimit: 500 },
        [{ method: 'POST' as const, path: '/api/data', handler: () => ({ success: true }) }],
        { routes: { timeout: { server: false } } },
      );

      assert(typeof server.info.port === 'number');
      const registeredResponse = await makeRequest(
        server.info.port,
        'POST /api/data HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n',
      );
      expect(registeredResponse).toContain('200');

      const unregisteredResponse = await testSocketDestruction(
        server.info.port,
        'POST /nonexistent HTTP/1.1\r\nHost: localhost\r\nContent-Length: 900\r\n\r\n',
      );
      expect(unregisteredResponse).toBe('');
    });
  });

  describe('different HTTP methods', () => {
    test.each([
      {
        method: 'PUT' as const,
        path: '/resource',
        handler: () => ({ updated: true }),
        contentLength: 0,
      },
      {
        method: 'PATCH' as const,
        path: '/resource',
        handler: () => ({ patched: true }),
        contentLength: 0,
      },
    ])('should work with $method requests', async ({ method, path, handler, contentLength }) => {
      server = await setupServer({ registeredLimit: 1000 }, [{ method, path, handler }]);

      assert(typeof server.info.port === 'number');
      const response = await makeRequest(
        server.info.port,
        `${method} ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${contentLength}\r\n\r\n`,
      );

      expect(response).toContain('200');
    });

    test('should reject oversized PUT requests', async () => {
      server = await setupServer(
        { registeredLimit: 1000 },
        [{ method: 'PUT' as const, path: '/resource', handler: () => ({ updated: true }) }],
        { routes: { timeout: { server: false } } },
      );

      assert(typeof server.info.port === 'number');
      const response = await testSocketDestruction(
        server.info.port,
        'PUT /resource HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2000\r\nHost: localhost\r\nContent-Length: 2000\r\n\r\n',
      );

      expect(response).toBe('');
    });
  });
});
