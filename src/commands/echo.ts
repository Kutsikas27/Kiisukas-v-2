import { ApplyOptions } from "@sapphire/decorators";
import { Command } from "@sapphire/framework";

@ApplyOptions<Command.Options>({
  name: "echo",
  description: "Bot kordab sõnumi valitud tekstiga",
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)

        .addStringOption((option) =>
          option
            .setName("input")
            .setDescription("sisesta tekst")
            .setRequired(true),
        ),
    );
  }
  public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const input = interaction.options.getString("input")!;
    interaction.channel?.send(input);
    await interaction.reply({ content: "Sõnum edastatud!", ephemeral: true });
  }
}
