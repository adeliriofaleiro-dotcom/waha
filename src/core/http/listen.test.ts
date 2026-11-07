import { createServer, Server } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';

import { ConfigService } from '@nestjs/config';
import { WhatsappConfigService } from '@waha/config.service';
import {
  bindNodeServer,
  httpListenArgs,
  InvalidListenHostError,
  listenNestApplication,
  ListenOptions,
  resolveListenOptions,
} from '@waha/core/http/listen';

const INVALID_HOSTS = [
  '',
  '   ',
  '\n',
  'localhost',
  'localhost.localdomain',
  '*',
  '+',
  '0',
  'example.com',
  '127.0.0.1:3000',
  '127.0.0.1/32',
  'http://127.0.0.1',
  '0.0.0.0.0',
  '::1%lo0',
  '[::1]:3000',
  ':::',
];

function createProbeServer(): Server {
  return createServer((_req, res) => {
    res.statusCode = 204;
    res.end();
  });
}

function readTcpAddress(
  server: Server,
): { address: string; port: number; family: string | number } {
  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('expected a TCP listen address');
  }
  return {
    address: address.address,
    port: address.port,
    family: address.family,
  };
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function connectTcp(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: host,
      port: port,
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timeout connecting to ${host}:${port}`));
    }, 1000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function externalIpv4Addresses(): string[] {
  const addresses: string[] = [];
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }
    for (const entry of entries) {
      const family = String(entry.family);
      if (entry.internal) {
        continue;
      }
      if (family !== 'IPv4' && family !== '4') {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  return addresses;
}

function createConfig(
  values: Record<string, string | undefined>,
): WhatsappConfigService {
  function get(name: string, defaultValue?: unknown) {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      return values[name];
    }
    return defaultValue;
  }
  const configService = {
    get: get,
  };
  return new WhatsappConfigService(configService as ConfigService);
}

describe('resolveListenOptions', () => {
  it('omits the host when WAHA_LISTEN_HOST is unset', () => {
    expect(resolveListenOptions('3000', undefined)).toEqual({
      port: '3000',
    });
    expect(resolveListenOptions('3000', null)).toEqual({
      port: '3000',
    });
  });

  it('trims a loopback address and keeps the port string', () => {
    expect(resolveListenOptions('3000', '  127.0.0.1  ')).toEqual({
      port: '3000',
      host: '127.0.0.1',
    });
  });

  it('normalizes a bracketed IPv6 loopback address', () => {
    expect(resolveListenOptions('3000', '[::1]')).toEqual({
      port: '3000',
      host: '::1',
    });
  });

  it.each(INVALID_HOSTS)(
    'rejects %j instead of producing a listen host',
    (listenHost) => {
      expect(() => resolveListenOptions('3000', listenHost)).toThrow(
        InvalidListenHostError,
      );
    },
  );
});

describe('httpListenArgs', () => {
  it('uses a single port argument when the host is unset', () => {
    const options = resolveListenOptions('3000', undefined);
    expect(httpListenArgs(options)).toEqual(['3000']);
  });

  it('passes 127.0.0.1 through as the host argument', () => {
    const options = resolveListenOptions('3000', '127.0.0.1');
    expect(httpListenArgs(options)).toEqual(['3000', '127.0.0.1']);
  });

  it('keeps an explicit all-interfaces address instead of dropping it', () => {
    expect(httpListenArgs(resolveListenOptions('3000', '0.0.0.0'))).toEqual([
      '3000',
      '0.0.0.0',
    ]);
    expect(httpListenArgs(resolveListenOptions('3000', '::'))).toEqual([
      '3000',
      '::',
    ]);
  });

  it('rejects an empty host that Node would treat as all interfaces', () => {
    const options: ListenOptions = {
      port: '3000',
      host: '',
    };
    expect(() => httpListenArgs(options)).toThrow(InvalidListenHostError);
  });
});

describe('listenNestApplication', () => {
  it('calls listen(port) when the host is unset', async () => {
    const calls: unknown[][] = [];
    const app = {
      listen: async function listen(...args: unknown[]) {
        calls.push(args);
      },
    };
    await listenNestApplication(app, resolveListenOptions('3000', undefined));
    expect(calls).toEqual([['3000']]);
  });

  it('calls listen(port, 127.0.0.1) for the loopback host', async () => {
    const calls: unknown[][] = [];
    const app = {
      listen: async function listen(...args: unknown[]) {
        calls.push(args);
      },
    };
    await listenNestApplication(app, resolveListenOptions('3000', '127.0.0.1'));
    expect(calls).toEqual([['3000', '127.0.0.1']]);
  });

  it('does not call listen when the host is invalid', async () => {
    const listen = jest.fn();
    const app = {
      listen: listen,
    };
    const options: ListenOptions = {
      port: '3000',
      host: 'localhost',
    };
    await expect(listenNestApplication(app, options)).rejects.toBeInstanceOf(
      InvalidListenHostError,
    );
    expect(listen).not.toHaveBeenCalled();
  });
});

describe('bindNodeServer', () => {
  it('binds 127.0.0.1 and rejects other local addresses', async () => {
    const server = createProbeServer();
    try {
      await bindNodeServer(server, resolveListenOptions('0', '127.0.0.1'));
      const bound = readTcpAddress(server);
      expect(bound.address).toBe('127.0.0.1');
      expect(String(bound.family)).toMatch(/IPv4|4/);
      expect(['0.0.0.0', '::']).not.toContain(bound.address);

      const response = await fetch(`http://127.0.0.1:${bound.port}/`);
      expect(response.status).toBe(204);

      await expect(
        connectTcp('127.0.0.1', bound.port),
      ).resolves.toBeUndefined();
      await expect(connectTcp('::1', bound.port)).rejects.toBeTruthy();

      const external = externalIpv4Addresses();
      expect(external.length).toBeGreaterThan(0);
      for (const host of external) {
        await expect(connectTcp(host, bound.port)).rejects.toMatchObject({
          code: 'ECONNREFUSED',
        });
      }
    } finally {
      await closeServer(server);
    }
  });

  it('binds ::1 when that address is configured', async () => {
    const server = createProbeServer();
    try {
      await bindNodeServer(server, resolveListenOptions('0', '[::1]'));
      const bound = readTcpAddress(server);
      expect(bound.address).toBe('::1');
      await expect(connectTcp('127.0.0.1', bound.port)).rejects.toMatchObject({
        code: 'ECONNREFUSED',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('keeps the Node default address when the host is unset', async () => {
    const server = createProbeServer();
    try {
      await bindNodeServer(server, resolveListenOptions('0', undefined));
      const bound = readTcpAddress(server);
      expect(['0.0.0.0', '::']).toContain(bound.address);
    } finally {
      await closeServer(server);
    }
  });

  it('does not open a socket for an empty listen host', async () => {
    const server = createProbeServer();
    const listen = jest.spyOn(server, 'listen');
    try {
      expect(() => resolveListenOptions('0', '')).toThrow(
        InvalidListenHostError,
      );
      expect(listen).not.toHaveBeenCalled();
      expect(server.listening).toBe(false);
      expect(server.address()).toBeNull();
    } finally {
      listen.mockRestore();
      await closeServer(server);
    }
  });

  it('does not fall back to all interfaces when the address cannot be bound', async () => {
    const server = createProbeServer();
    try {
      await expect(
        bindNodeServer(server, resolveListenOptions('0', '192.0.2.1')),
      ).rejects.toMatchObject({
        code: 'EADDRNOTAVAIL',
      });
      expect(server.listening).toBe(false);
      expect(server.address()).toBeNull();
    } finally {
      await closeServer(server);
    }
  });
});

describe('WhatsappConfigService listen host', () => {
  it('does not take the listen address from WHATSAPP_API_HOSTNAME', () => {
    const config = createConfig({
      WHATSAPP_API_SCHEMA: 'http',
      WHATSAPP_API_HOSTNAME: '203.0.113.10',
      WHATSAPP_API_PORT: '3000',
    });
    expect(config.hostname).toBe('203.0.113.10');
    expect(config.baseUrl).toBe('http://203.0.113.10:3000');
    expect(config.listenOptions).toEqual({
      port: '3000',
    });
    expect(config.listenOptions.host).toBeUndefined();
  });

  it('binds the configured loopback address without changing generated URLs', () => {
    const config = createConfig({
      WHATSAPP_API_SCHEMA: 'http',
      WHATSAPP_API_HOSTNAME: '203.0.113.10',
      WHATSAPP_API_PORT: '3000',
      WAHA_BASE_URL: 'http://203.0.113.10:3000/base',
      WAHA_LISTEN_HOST: '127.0.0.1',
    });
    expect(config.baseUrl).toBe('http://203.0.113.10:3000/base');
    expect(config.listenOptions).toEqual({
      port: '3000',
      host: '127.0.0.1',
    });
  });

  it('uses the same PORT precedence as the existing port getter', () => {
    const config = createConfig({
      PORT: '4010',
      WHATSAPP_API_PORT: '3000',
      WAHA_LISTEN_HOST: '127.0.0.1',
    });
    expect(config.port).toBe('4010');
    expect(config.listenOptions).toEqual({
      port: '4010',
      host: '127.0.0.1',
    });
  });

  it('rejects an invalid listen host from configuration', () => {
    const empty = createConfig({
      WAHA_LISTEN_HOST: '',
    });
    expect(() => empty.listenOptions).toThrow(InvalidListenHostError);

    const hostname = createConfig({
      WHATSAPP_API_HOSTNAME: '127.0.0.1',
      WAHA_LISTEN_HOST: 'localhost',
    });
    expect(() => hostname.listenOptions).toThrow(InvalidListenHostError);
    expect(hostname.hostname).toBe('127.0.0.1');
  });
});
