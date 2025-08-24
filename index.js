require("dotenv").config();
const {
  Client,
  Intents,
  MessageEmbed,
  MessageActionRow,
  MessageSelectMenu,
  MessageAttachment,
} = require("discord.js");
const axios = require("axios");
const fs = require("fs");
const child_process = require("child_process");
const path = require("path");

const log = (...e) => console.log("[NOVA]", ...e);
const error = (...e) => console.error("[NOVA]", ...e);

const tempDir = path.join(__dirname, "Temp_files");
if (!fs.existsSync(tempDir)) {
  error("Temp_files directory does not exist! Please create it manually.");
  process.exit(1);
}

const STORAGE_CHANNEL_ID =
  process.env.STORAGE_CHANNEL_ID || process.env.CDN_STORAGE_CHANNEL_ID;

async function ensureStorageChannel(client) {
  if (!STORAGE_CHANNEL_ID)
    throw new Error("STORAGE_CHANNEL_ID is not set in .env");
  let ch = client.channels.cache.get(STORAGE_CHANNEL_ID);
  if (!ch) ch = await client.channels.fetch(STORAGE_CHANNEL_ID).catch(() => null);
  if (!ch || !("send" in ch))
    throw new Error(
      "STORAGE_CHANNEL_ID does not point to a text channel the bot can send to."
    );
  return ch;
}

function obfuscate(inputFile, preset) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(tempDir, `obfuscated_${Date.now()}.lua`);
    const proc = child_process.spawn("./bin/luajit.exe", [
      "./lua/cli.lua",
      "--preset",
      preset,
      inputFile,
      "--out",
      outputFile,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0)
        return reject(stderr || `luajit exited with code ${code}`);
      resolve(outputFile);
    });
  });
}

function formatFooterTimestamp() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `Today at ${hour12}:${minutes} ${ampm}`;
}

const tokens = Object.keys(process.env)
  .filter((key) => key.startsWith("DISCORD_TOKEN"))
  .map((key) => process.env[key]);

if (tokens.length === 0) {
  error("No DISCORD_TOKEN found in .env!");
  process.exit(1);
}

function createBot(token, botNumber) {
  const client = new Client({
    intents: [
      Intents.FLAGS.GUILDS,
      Intents.FLAGS.GUILD_MESSAGES,
      Intents.FLAGS.DIRECT_MESSAGES,
    ],
    partials: ["CHANNEL"],
  });

  client.once("ready", () => {
    log(`Bot #${botNumber} logged in as ${client.user?.tag || "Unknown"}`);

    client.user.setPresence({
      status: "dnd",
      activities: [
        {
          name: "Obfuscating Nova Files",
          type: "PLAYING",
        },
      ],
    });
  });

  client.login(token);

  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    if (msg.content.toLowerCase() === ".help") {
      const helpText = `Nova Obfuscator Help
Usage:
.obf [attach your .lua/.txt file or paste inside a codeblock]

Presets:
Minify — Compress only
Weak — Light protection
Medium — Balanced protection
Strong — Heavy protection

Always use in DMs for privacy!`;

      const helpEmbed = new MessageEmbed()
        .setColor("PURPLE")
        .setTitle("Nova Obfuscator Help")
        .setDescription(helpText)
        .setFooter({
          text: "Made by Slayerson • Credits to Vyxonq • Powered by Nova Obfuscator",
        });

      msg.channel
        .send({ embeds: [helpEmbed] })
        .catch((err) => error("Failed to send help message:", err));
      return;
    }

    if (msg.content.toLowerCase().startsWith(".obf")) {
      let inputFile;
      let originalFileName;

      const attachment = msg.attachments.first();
      if (attachment) {
        const ext = path.extname(attachment.name).toLowerCase();
        if (ext !== ".lua" && ext !== ".txt") {
          const errorEmbed = new MessageEmbed()
            .setColor("PURPLE")
            .setTitle("Obfuscation Failed")
            .setDescription("Only .lua and .txt files are supported!");
          msg.reply({ embeds: [errorEmbed] });
          return;
        }

        inputFile = path.join(tempDir, `input_${Date.now()}${ext}`);
        const response = await axios({
          method: "GET",
          url: attachment.url,
          responseType: "stream",
        });
        response.data.pipe(fs.createWriteStream(inputFile));
        await new Promise((resolve, reject) => {
          response.data.on("end", resolve);
          response.data.on("error", reject);
        });
        originalFileName = attachment.name;
      } else {
        const codeBlockMatch = msg.content.match(/```(?:lua)?\n([\s\S]*?)```/i);
        if (!codeBlockMatch) {
          const errorEmbed = new MessageEmbed()
            .setColor("PURPLE")
            .setTitle("Obfuscation Failed")
            .setDescription("Attach a .lua/.txt file or paste inside a codeblock!");
          msg.reply({ embeds: [errorEmbed] });
          return;
        }

        const code = codeBlockMatch[1];
        inputFile = path.join(tempDir, `input_${Date.now()}.lua`);
        fs.writeFileSync(inputFile, code, "utf-8");
        originalFileName = `codeblock_${Date.now()}.lua`;
      }

      coonst chooseEmbed = new MessageEmbed()
        .setColor("PURPLE")
        .setTitle("🔐 Choose Obfuscation Level")
        .setDescription("Please select the obfuscation level:\nSelect wisely for the best protection! 🧐");

      const row = new MessageActionRow().addComponents(
        new MessageSelectMenu()
          .setCustomId(`obfuscation_level_${Date.now()}`)
          .setPlaceholder("🛡️ Select Obfuscation Level")
          .addOptions([
            { label: "Weak", description: "Weak Obfuscation Level 🪶", value: "Weak" },
            { label: "Medium", description: "Medium Obfuscation Level 🛡️", value: "Medium" },
            { label: "Strong", description: "Strong Obfuscation Level 💪", value: "Strong" },
          ])
      );


      const promptMsg = await msg.reply({
        embeds: [chooseEmbed],
        components: [row],
      });

      const filter = (i) => i.user.id === msg.author.id;
      const collector = promptMsg.createMessageComponentCollector({
        filter,
        componentType: "SELECT_MENU",
        time: 60000,
      });

      collector.on("collect", async (i) => {
        await i.deferUpdate();
        const selected = i.values[0];
        collector.stop();

        const workingEmbed = new MessageEmbed()
          .setColor("PURPLE")
          .setTitle("Processing File")
          .setDescription(
            selected === "Minify"
              ? "Minifying 1 file(s)..."
              : "Obfuscating 1 file(s)..."
          );

        const workingMsg = await msg.reply({ embeds: [workingEmbed] });

        let outputFile;
        try {
          outputFile = await obfuscate(inputFile, selected);
        } catch (err) {
          error(err);
          await workingMsg.edit({
            embeds: [
              new MessageEmbed()
                .setColor("PURPLE")
                .setTitle("Failed")
                .setDescription("Something went wrong. Please try again."),
            ],
          });
          return;
        }

        const finalFile = path.join(
          tempDir,
          `obfuscated_final_${Date.now()}.lua`
        );
        fs.copyFileSync(outputFile, finalFile);

        let obfuscatedCode = fs.readFileSync(finalFile, "utf-8");
        const watermark = "--[[\n\nObfuscated By Nova Obfuscator\n\njoin discord to use Obfuscator = discord.gg/nova-hub\n\n Made by Slayerson Server Owned By EncryptedV10\n]]\n\n ";
        if (!obfuscatedCode.startsWith(watermark)) {
          obfuscatedCode = watermark + obfuscatedCode.trimStart();
          fs.writeFileSync(finalFile, obfuscatedCode, "utf-8");
        }

        let fileUrl;
        try {
          const storageChannel = await ensureStorageChannel(client);
          const storageMsg = await storageChannel.send({
            files: [new MessageAttachment(finalFile, originalFileName)],
          });
          fileUrl = storageMsg.attachments.first()?.url;
        } catch (e) {
          error("Storage upload failed:", e);
          await workingMsg.edit({
            embeds: [
              new MessageEmbed()
                .setColor("PURPLE")
                .setTitle("Storage Upload Failed")
                .setDescription("Could not upload file to storage channel."),
            ],
          });
          return;
        }

        const preview =
          obfuscatedCode.length > 500
            ? obfuscatedCode.slice(0, 500) + "..."
            : obfuscatedCode;

        const successEmbed = new MessageEmbed()
          .setColor("PURPLE")
          .setTitle(
            selected === "Minify"
              ? "Minification Results"
              : "Obfuscation Results"
          )
          .setDescription(
            `${originalFileName}\n[ Click here to download](${fileUrl})\n\n\`\`\`lua\n${preview}\n\`\`\``
          )
          .setFooter({
            text: `Made by Slayerson • Credits to Vyxonq • Powered by Nova Obfuscator • ${formatFooterTimestamp()}`,
          });

        await workingMsg.edit({ embeds: [successEmbed] });

        try {
          fs.unlinkSync(inputFile);
          fs.unlinkSync(outputFile);
          fs.unlinkSync(finalFile);
        } catch (err) {
          error("Cleanup failed:", err);
        }
        try {
          await promptMsg.delete();
        } catch {}
      });

      collector.on("end", (collected) => {
        if (collected.size === 0) {
          const cancelEmbed = new MessageEmbed()
            .setColor("PURPLE")
            .setTitle("Canceled")
            .setDescription("No selection made in time. Please try again.");
          msg.reply({ embeds: [cancelEmbed] });
        }
      });
    }
  });
}

tokens.forEach((token, index) => createBot(token, index + 1));
