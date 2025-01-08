import { Redis } from "@upstash/redis"
import dotenv from "dotenv"
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  InteractionType,
  ModalBuilder,
  TextInputBuilder,
  TextInputComponent,
  TextInputStyle,
  ButtonStyle,
} from "discord.js"

dotenv.config()

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

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

const targetGuildId = process.env.SERVER_ID
const targetChannelId = process.env.CHANNEL_ID
const ticketCategoryId = process.env.CATEGORY_ID
const ERROR_CHANNEL_ID = process.env.ERROR_CHANNEL_ID
const supportID = process.env.SUPPORT_ID

// Redis Helper Functions
async function redisSet(key, value) {
  return redis.set(key, JSON.stringify(value))
}

async function redisGet(key) {
  console.log("key", key)
  const value = await redis.get(key)
  console.log("value", value)

  if (typeof value === "string") {
    try {
      const parsedValue = JSON.parse(value)
      console.log("parsedValue", parsedValue)
      return parsedValue
    } catch (error) {
      console.error("Failed to parse value as JSON:", value, error.message)
      return null
    }
  }

  console.log("Returning raw value (non-string)", value)
  return value
}

async function redisDelete(key) {
  await redis.del(key)
}

async function getTicketCounter() {
  const counter = await redisGet("ticketCounter")
  return counter !== null ? counter : 1
}

async function incrementTicketCounter() {
  const counter = await getTicketCounter()
  await redisSet("ticketCounter", counter + 1)
  return counter
}

client.once(Events.ClientReady, async readyClient => {
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
      const attachments = message.attachments
      console.log("message.attachments", message.attachments)

      try {
        const guild = await client.guilds.fetch(targetGuildId)

        // Check if the user already has a ticket channel

        let existingChannel = await redisGet(discordID)

        if (existingChannel) {
          const ticketChannel = await guild.channels
            .fetch(existingChannel.channelId)
            .catch(() => null) // Handle deleted channels

          if (ticketChannel) {
            // If channel exists, send the query and attachments to it
            const msg = await ticketChannel.send({
              content: `Hello <@${existingChannel.userId}>,\nyour query has been received:\n\n**Query:** ${query}\n\nOur support team will be with you shortly <@${supportID}>`,
            })
            if (attachments.size > 0) {
              for (const attachment of attachments.values()) {
                console.log("attachment.url", attachment.url)
                await ticketChannel.send({
                  files: [attachment.url],
                })
              }
            }
            console.log(
              `Message sent to existing channel: ${ticketChannel.name}`
            )
            return
          } else {
            // If the channel was deleted, remove it from Redis
            console.log(`Channel for ${discordID} no longer exists.`)
            await redisDelete(discordID)
          }
        }

        // If no channel exists, create a new one
        const members = await guild.members.fetch()
        const member = members.find(
          m =>
            m.user.username === discordID ||
            m.user.tag === discordID ||
            m.user.globalName === discordID
        )

        if (!member) {
          console.log(`User with ID ${discordID} not found in the guild.`)
          const adminChannel = await message.guild.channels
            .fetch(ERROR_CHANNEL_ID)
            .catch(() => null)

          if (adminChannel) {
            await adminChannel.send(
              `⚠️ <@${supportID}> User with ID ${discordID} not found in the guild.`
            )
          }
          return
        }

        // Increment the ticket counter
        const ticketCounter = await incrementTicketCounter()

        const ticketChannel = await guild.channels.create({
          name: `ticket-${ticketCounter}`,
          type: 0, // Text channel
          parent: ticketCategoryId,
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

        // Store the information in Redis
        console.log("before")
        const data = await redis.set(discordID, {
          channelId: ticketChannel.id,
          userId: member.user.id,
        })
        console.log("redis data :", data)
        console.log("after")
        // Send the query to the newly created channel
        const msg = await ticketChannel.send({
          content: `Hello <@${member.user.id}>,\nyour query has been received:\n\n**Query:** ${query}\n\nOur support team will be with you shortly <@${supportID}>`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("close-ticket")
                .setLabel("Close Ticket")
                .setStyle(ButtonStyle.Danger)
            ),
          ],
        })
        if (attachments.size > 0) {
          for (const attachment of attachments.values()) {
            console.log("attachment.url", attachment.url)
            await ticketChannel.send({
              files: [attachment.url],
            })
          }
        }
        console.log("message send")
        console.log(`Created channel: ${ticketChannel.name}`)
      } catch (error) {
        console.error(`Failed to handle message: ${error.message}`)

        const adminChannel = await message.guild.channels
          .fetch(ERROR_CHANNEL_ID)
          .catch(() => null)

        if (adminChannel) {
          await adminChannel.send(
            `⚠️ <@${supportID}>  An error occurred while processing a ticket:\n**Error:** ${error.message}`
          )
        }
      }
    }
  }
})

// Handle button interactions
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return

  try {
    if (interaction.isButton() && interaction.customId === "close-ticket") {
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("cancel-close-ticket")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("confirm-close-ticket-final")
          .setLabel("Close Ticket")
          .setStyle(ButtonStyle.Danger)
      )

      await interaction.reply({
        content: "Are you sure you want to close this ticket?",
        components: [actionRow],
      })
      return
    }

    // Handle button interactions from the confirmation message
    console.log("interaction.customId", interaction.customId)
    // Handle "Cancel" button
    if (
      interaction.isButton() &&
      interaction.customId === "cancel-close-ticket"
    ) {
      await interaction.update({
        content: "Ticket closure canceled.",
        components: [], // Remove buttons
      })
      return
    }
    if (
      interaction.isButton() &&
      interaction.customId === "confirm-close-ticket-final"
    ) {
      try {
        const channel = interaction.channel
        const user = interaction.user

        await redisGet(interaction.user.username)

        await channel.delete("Ticket closed by user")
        await redisDelete(interaction.user.username)
        console.log(`Channel ${channel.name} deleted by user ${user.tag}`)
      } catch (error) {
        console.error(`Error closing ticket: ${error.message}`)
        await interaction.reply({
          content: "An error occurred while closing the ticket.",
        })
      }
      return
    }
  } catch (error) {
    console.error(`Failed to handle button interaction: ${error.message}`)

    const adminChannel = await interaction.guild.channels
      .fetch(ERROR_CHANNEL_ID)
      .catch(() => null)

    if (adminChannel) {
      await adminChannel.send(
        `⚠️ <@${supportID}> An error occurred while processing a ticket:\n**Error:** ${error.message}`
      )
    }
  }
})

// // Handle modal submissions
// client.on(Events.InteractionCreate, async interaction => {
//   if (!interaction.isModalSubmit()) return

//   if (interaction.customId === "confirm-close-ticket") {
//     try {
//       const confirmation = interaction.fields
//         .getTextInputValue("confirm-close")
//         .trim()

//       if (confirmation.toUpperCase() !== "CLOSE") {
//         await interaction.reply({
//           content: "Ticket closure canceled. Type 'CLOSE' exactly to confirm.",
//           ephemeral: true,
//         })
//         return
//       }

//       const channel = interaction.channel
//       const user = interaction.user

//       // Delete channel and Redis entry
//       await redisDelete(user.username)
//       await channel.delete("Ticket closed by user")
//       console.log(`Channel ${channel.name} deleted by user ${user.tag}`)
//     } catch (error) {
//       console.error(`Failed to handle modal submission: ${error.message}`)

//       const adminChannel = await interaction.guild.channels
//         .fetch(ERROR_CHANNEL_ID)
//         .catch(() => null)

//       if (adminChannel) {
//         await adminChannel.send(
//           `⚠️ <@${supportID}> An error occurred while processing a ticket:\n**Error:** ${error.message}`
//         )
//       }
//     }
//   }
// })

// Handle button interactions
// client.on(Events.InteractionCreate, async interaction => {
//   if (!interaction.isButton()) return

//   if (interaction.customId === "close-ticket") {
//     try {
// const channel = interaction.channel
// const user = interaction.user

// await redisGet(interaction.user.username)

// await channel.delete("Ticket closed by user")
// await redisDelete(interaction.user.username)
// console.log(`Channel ${channel.name} deleted by user ${user.tag}`)
//     } catch (error) {
//       console.error(`Failed to handle message: ${error.message}`)

//       const adminChannel = await interaction.guild.channels
//         .fetch(ERROR_CHANNEL_ID)
//         .catch(() => null)

//       if (adminChannel) {
//         await adminChannel.send(
//           `⚠️  An error occurred while processing a ticket:\n**Error:** ${error.message}`
//         )
//       }
//     }
//   }
// })

client.login(process.env.DISCORD_TOKEN)
