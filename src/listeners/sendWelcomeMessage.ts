import { Listener } from "@sapphire/framework";
import type { Events, GuildMember } from "discord.js";
import { ChannelType, EmbedBuilder } from "discord.js";
import humanizeDuration from "humanize-duration";

export class UserListener extends Listener<Events.GuildMemberAdd> {
  public constructor(context: Listener.Context, options: Listener.Options) {
    super(context, {
      ...options,
      event: "guildMemberAdd",
    });
  }
  public async run(member: GuildMember) {
    const channel = member.guild.channels.cache.get(
      process.env.JOIN_LEAVE_CHANNEL_ID || "",
    );
    if (!channel) return console.log("JOIN_LEAVE_CHANNEL_ID on seadistamata");
    if (channel.type !== ChannelType.GuildText) {
      return console.log(this.name, `Ei ole tekstikanal`);
    }
    const accountAge = Date.now() - member.user.createdTimestamp;

    const embed = new EmbedBuilder()
      .setTitle(`${member.displayName} liitus serveriga! 👋`)
      .setDescription(
        `Nimi:<@${member.id}>
         Konto vanus: ${humanizeDuration(accountAge, {
           language: "et",
           round: true,
           conjunction: " ja ",
           largest: 2,
           serialComma: false,
         })}`,
      )
      .setThumbnail(`${member.user.displayAvatarURL()}`)
      .setColor("#18E72B");

    await channel.send({ embeds: [embed] });
  }
}
