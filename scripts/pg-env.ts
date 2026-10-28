import net from 'node:net';
import pg from 'pg';

/** a throwaway database per scenario run, so runs never see each other's data */
export async function createRunDatabase(adminUrl: string, name: string) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    async drop() {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await c.end();
    },
  };
}

/**
 * TCP pass-through between the app and PostgreSQL. `down()` cuts every connection and refuses new ones,
 * which looks to the app exactly like the database going away; `up()` brings it back.
 */
export async function createDbProxy(target: { host: string; port: number }) {
  const sockets = new Set<net.Socket>();
  let isDown = false;
  const server = net.createServer((client) => {
    if (isDown) return client.destroy();
    const upstream = net.connect(target.port, target.host);
    sockets.add(client).add(upstream);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', drop).on('close', drop);
    upstream.on('error', drop).on('close', drop);
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    down() {
      isDown = true;
      for (const s of sockets) s.destroy();
      sockets.clear();
    },
    up() {
      isDown = false;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
