// Per-server connection settings, selected by the SERVER env var.

export type ServerName = 'openfire' | 'ejabberd' | 'prosody';

export interface ServerConfig {
  name: ServerName;
  domain: string;
  mucDomain: string;
  pubsubDomain: string;
  websocketUrl: string;
}

const configs: Record<ServerName, ServerConfig> = {
  // Ports and service domains are placeholders until each compose stack exists.
  openfire: {
    name: 'openfire',
    domain: 'localhost',
    mucDomain: 'conference.localhost',
    pubsubDomain: 'pubsub.localhost',
    websocketUrl: 'ws://localhost:7070/ws/',
  },
  ejabberd: {
    name: 'ejabberd',
    domain: 'localhost',
    mucDomain: 'conference.localhost',
    pubsubDomain: 'pubsub.localhost',
    websocketUrl: 'ws://localhost:5280/ws',
  },
  prosody: {
    name: 'prosody',
    domain: 'localhost',
    mucDomain: 'conference.localhost',
    pubsubDomain: 'pubsub.localhost',
    websocketUrl: 'ws://localhost:5280/xmpp-websocket',
  },
};

export function serverConfig(): ServerConfig {
  const name = process.env['SERVER'];
  if (!name || !(name in configs)) {
    throw new Error(`SERVER must be one of ${Object.keys(configs).join(', ')} (got ${name ?? 'unset'})`);
  }
  return configs[name as ServerName];
}
