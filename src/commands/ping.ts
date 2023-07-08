import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';

@ApplyOptions<Command.Options>({
  name: 'ping',
  description: 'Ping pong'
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) => builder.setName(this.name).setDescription(this.description));
  }

  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const milliseconds = Date.now() - interaction.createdTimestamp;
    const content = `Pong! Sinu sõnum jõudis minuni **${milliseconds}** millisekundiga.`;

    return await interaction.reply({ content });
  }
}
