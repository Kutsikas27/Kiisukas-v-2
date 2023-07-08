import './lib/setup';
import { Bot } from './lib/structures/Bot';

const client = new Bot();

const main = async () => {
  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
    client.logger.info(`Logged in as ${client.user?.tag}`);
  } catch (error) {
    client.logger.fatal(error);
    client.destroy();
    process.exit(1);
  }
};

main();
