import {
  ApplicationCommandRegistries,
  RegisterBehavior,
  SapphireClient,
} from "@sapphire/framework";
import { type ClientOptions, GatewayIntentBits, Partials } from "discord.js";

const options: ClientOptions = {
  defaultPrefix: "!",
  loadMessageCommandListeners: true,
  partials: [Partials.Channel],
  intents: [
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
  ],
};

ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(
  RegisterBehavior.BulkOverwrite,
);

export class Bot extends SapphireClient {
  public constructor() {
    super(options);
  }
  public async login(token?: string) {
    return super.login(token);
  }
}
