import { Listener } from "@sapphire/framework";
import { ActivityType, Client, type Events } from "discord.js";
import { DateTime } from "luxon";
import { initJobsShoutsService } from "../shouts/jobs";

export class UserListener extends Listener<Events.ClientReady> {
  public async run(client: Client) {
    client.logger.info("All systems ready!");
    if (!client.readyAt || !client.user) return;
    initJobsShoutsService();
    const uptime = DateTime.fromJSDate(client.readyAt)
      .setZone("Europe/Tallinn")
      .toFormat("dd.MM HH:mm");
    client.user.setActivity(`since ${uptime}`, {
      type: ActivityType.Playing,
    });
//test
  }
}
