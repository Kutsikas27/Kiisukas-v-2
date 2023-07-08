import { Listener } from '@sapphire/framework';
import type { Client, Events } from 'discord.js';

export class UserListener extends Listener<Events.ClientReady> {
  public async run(client: Client) {
    client.logger.info('All systems ready!');
  }
}
