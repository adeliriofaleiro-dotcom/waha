import { Server } from 'node:http';
import { isIP } from 'node:net';

/**
 * TCP address for the HTTP server that serves the API, dashboard, Swagger,
 * and the /ws socket. Unset keeps Node's historical listen(port) behavior.
 * WHATSAPP_API_HOSTNAME and WAHA_BASE_URL are not consulted: they only build URLs.
 */
export const WAHA_LISTEN_HOST_ENV = 'WAHA_LISTEN_HOST';

export class InvalidListenHostError extends Error {
  readonly listenHost: string;

  constructor(listenHost: string) {
    super(
      `${WAHA_LISTEN_HOST_ENV} is invalid (${JSON.stringify(listenHost)}). ` +
        'Set an IP address such as 127.0.0.1 or ::1. ' +
        'Leave the variable unset to keep the default Node listen address. ' +
        'Empty and non-IP values are rejected and the server does not bind.',
    );
    this.name = 'InvalidListenHostError';
    this.listenHost = listenHost;
  }
}

export interface ListenOptions {
  port: string;
  host?: string;
}

export interface NestHttpApplication {
  listen(port: string, hostname?: string): Promise<unknown>;
}

/**
 * Resolve the listen socket from the port string already used by the process
 * and the raw WAHA_LISTEN_HOST value.
 * undefined / null means the variable is unset and the host is omitted.
 * An empty or non-IP value throws. It is never treated as "listen everywhere".
 */
export function resolveListenOptions(
  port: string,
  listenHost: string | undefined | null,
): ListenOptions {
  const host = parseListenHost(listenHost);
  if (host === undefined) {
    return {
      port: port,
    };
  }
  return {
    port: port,
    host: host,
  };
}

export function parseListenHost(
  listenHost: string | undefined | null,
): string | undefined {
  if (listenHost == null) {
    return undefined;
  }
  if (typeof listenHost !== 'string') {
    throw new InvalidListenHostError(String(listenHost));
  }
  const trimmed = listenHost.trim();
  if (trimmed.length === 0) {
    throw new InvalidListenHostError(listenHost);
  }
  const host = stripIpv6Brackets(trimmed);
  if (!isBindableIp(host)) {
    throw new InvalidListenHostError(listenHost);
  }
  return host;
}

/**
 * Arguments for listen(port) or listen(port, host).
 * A non-IP host throws before a socket is opened, including "" which Node
 * would otherwise treat like an omitted host (all interfaces).
 */
export function httpListenArgs(
  options: ListenOptions,
): [string] | [string, string] {
  if (options.host === undefined) {
    return [options.port];
  }
  if (!isBindableIp(options.host)) {
    throw new InvalidListenHostError(options.host);
  }
  return [options.port, options.host];
}

export async function listenNestApplication(
  app: NestHttpApplication,
  options: ListenOptions,
): Promise<void> {
  const args = httpListenArgs(options);
  if (args.length === 1) {
    await app.listen(args[0]);
    return;
  }
  await app.listen(args[0], args[1]);
}

/**
 * Bind a Node HTTP server with the same host decision as listenNestApplication.
 * Tests use this to read the kernel socket address back.
 */
export function bindNodeServer(
  server: Server,
  options: ListenOptions,
): Promise<void> {
  const args = httpListenArgs(options);
  const port = parseListenPort(args[0]);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      server.off('error', onError);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const onError = (error: Error) => {
      finish(error);
    };
    server.once('error', onError);
    const onListening = () => {
      finish();
    };
    if (args.length === 1) {
      server.listen(port, onListening);
      return;
    }
    server.listen(port, args[1], onListening);
  });
}

function isBindableIp(host: string): boolean {
  // Node treats a zone index (fe80::1%eth0) as an IP. Reject it so a scoped
  // LAN address cannot be selected by a value that only looks like loopback.
  if (host.includes('%')) {
    return false;
  }
  return isIP(host) !== 0;
}

function stripIpv6Brackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']') && host.length > 2) {
    return host.slice(1, -1);
  }
  return host;
}

function parseListenPort(port: string): number {
  if (!/^[0-9]+$/.test(port)) {
    throw new Error(
      `Invalid listen port ${JSON.stringify(
        port,
      )}. Expected an integer from 0 to 65535.`,
    );
  }
  const parsed = Number(port);
  if (parsed > 65535) {
    throw new Error(
      `Invalid listen port ${JSON.stringify(
        port,
      )}. Expected an integer from 0 to 65535.`,
    );
  }
  return parsed;
}
