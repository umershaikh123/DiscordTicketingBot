const dotenv = require("dotenv")
const {
  Client,
  Events,
  GatewayIntentBits,
  PermissionsBitField,
} = require("discord.js")

dotenv.config()

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
})

let ticketCounter = 1 // Counter for ticket channels
const targetGuildId = "842787726633992212" // Replace with your guild ID
const targetChannelId = "1323152325832998924" // Replace with your channel ID
const ticketCategoryId = "842787726633992213" // Replace with your category ID

client.once(Events.ClientReady, readyClient => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`)
})

client.on(Events.MessageCreate, async message => {
  if (
    message.guildId === targetGuildId &&
    message.channelId === targetChannelId
  ) {
    const content = message.content

    // Match the pattern for feedback messages
    const feedbackRegex =
      /\*\*discordID:\*\*\s*`([^`]+)`\s*\*\*Query:\*\*\s*`([^`]+)`/
    const match = content.match(feedbackRegex)

    if (match) {
      const discordID = match[1]
      const query = match[2]

      try {
        const guild = await client.guilds.fetch(targetGuildId)

        // Fetch the member dynamically
        let member
        try {
          member = await guild.members.fetch(discordID)
        } catch {
          // Fallback to find by username or tag
          const members = await guild.members.fetch()
          member = members.find(
            m =>
              m.user.username === discordID ||
              m.user.tag === discordID ||
              m.user.globalName === discordID
          )
        }

        if (!member) {
          console.log(`User with ID ${discordID} not found in the guild.`)
          return
        }

        // Create a new ticket channel under the specified category
        const channelName = `ticket-${ticketCounter}`
        ticketCounter++

        const ticketChannel = await guild.channels.create({
          name: channelName,
          type: 0, // Text channel
          parent: ticketCategoryId, // Set the category for the channel
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id, // Deny access for everyone
              deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
              id: member.user.id, // Allow access for the specific user
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
              ],
            },
            {
              id: client.user.id, // Grant permissions to the bot
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ManageChannels,
              ],
            },
          ],
        })

        // Post the query in the new channel
        await ticketChannel.send(
          `Hello <@${member.user.id}>,\nyour query has been received:\n\n**Query:** ${query}`
        )
        console.log(`Created channel: ${ticketChannel.name}`)
      } catch (error) {
        console.error(`Failed to create ticket channel: ${error.message}`)
      }
    }
  }
})

client.login(process.env.DISCORD_TOKEN)
