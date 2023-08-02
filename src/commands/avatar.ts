import { ApplyOptions } from '@sapphire/decorators';
import { isGuildMember } from '@sapphire/discord.js-utilities';
import { Command } from '@sapphire/framework';
import { EmbedBuilder } from 'discord.js';

@ApplyOptions<Command.Options>({
  name: 'avatar',
  description: 'Näitab kasutaja avatari täissuuruses'
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .addUserOption((option) => option.setName('kasutaja').setDescription('vali kasutaja').setRequired(true))
    );
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const member = interaction.options.getMember('kasutaja');
    if (!member || !isGuildMember(member)) return interaction.reply('kasutajat ei leitud');
    const embed = new EmbedBuilder().setTitle(`${member.displayName} avatar.`).setImage(member.displayAvatarURL({ size: 1024 }));

    return await interaction.reply({ embeds: [embed] });
  }
}
