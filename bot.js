const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, ChannelType,
} = require("discord.js");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

// ══════════════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════════════
const PREFIX       = "cch";           // prefix utama semua user
const STAFF_PREFIX = "cch!";          // prefix khusus staff
const OWNER_PREFIX = "cch!!";         // prefix khusus owner

const CONFIG = {
  OWNER_IDS:           (process.env.OWNER_IDS || "").split(",").map(s => s.trim()).filter(Boolean),
  VERIFY_CHANNEL_ID:   process.env.VERIFY_CHANNEL_ID,
  LOG_CHANNEL_ID:      process.env.LOG_CHANNEL_ID,
  FEMALE_ROLE_ID:      process.env.FEMALE_ROLE_ID,
  STAFF_ROLE_ID:       process.env.STAFF_ROLE_ID,
  TICKET_CATEGORY_ID:  process.env.TICKET_CATEGORY_ID,
  GIVEAWAY_CHANNEL_ID: process.env.GIVEAWAY_CHANNEL_ID,

  PINK:    0xF472B6,
  VIOLET:  0xA855F7,
  SUCCESS: 0x34D399,
  DANGER:  0xF87171,
  GOLD:    0xFBBF24,
};

// In-memory giveaway store
const giveaways = new Map();

// ══════════════════════════════════════════════════════════════════
//  READY
// ══════════════════════════════════════════════════════════════════
client.once("ready", () => {
  console.log(`\n  ✦ ${client.user.tag} siap!\n`);
  console.log(`  Prefix umum  : ${PREFIX}`);
  console.log(`  Prefix staff : ${STAFF_PREFIX}`);
  console.log(`  Prefix owner : ${OWNER_PREFIX}\n`);
  client.user.setActivity(`${PREFIX}help | 🌸 Verify & Giveaway`, { type: 3 });
});

// ══════════════════════════════════════════════════════════════════
//  PREFIX COMMAND HANDLER
// ══════════════════════════════════════════════════════════════════
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  const content = msg.content.trim();

  // ── Deteksi prefix level ───────────────────────────────────────
  let level = null;
  let args   = [];
  let cmd    = "";

  if (content.startsWith(OWNER_PREFIX)) {
    level = "owner";
    const parts = content.slice(OWNER_PREFIX.length).trim().split(/\s+/);
    cmd  = parts[0]?.toLowerCase();
    args = parts.slice(1);
  } else if (content.startsWith(STAFF_PREFIX)) {
    level = "staff";
    const parts = content.slice(STAFF_PREFIX.length).trim().split(/\s+/);
    cmd  = parts[0]?.toLowerCase();
    args = parts.slice(1);
  } else if (content.startsWith(PREFIX)) {
    level = "user";
    const parts = content.slice(PREFIX.length).trim().split(/\s+/);
    cmd  = parts[0]?.toLowerCase();
    args = parts.slice(1);
  } else {
    return;
  }

  // ══════════════════════════════════════════════════════════════
  //  OWNER COMMANDS  (cch!! <cmd>)
  // ══════════════════════════════════════════════════════════════
  if (level === "owner") {
    if (!isOwner(msg.author.id)) {
      return msg.reply({ embeds: [errEmbed("Hanya owner yang bisa menggunakan perintah ini.")] });
    }

    // cch!! verifysetup
    if (cmd === "verifysetup") {
      const embed = buildVerifyPanel();
      const row   = verifyPanelRow();
      await msg.channel.send({ embeds: [embed], components: [row] });
      await msg.delete().catch(() => {});
      return;
    }

    // cch!! giveaway <durasi> <pemenang> <#channel> <hadiah...>
    // contoh: cch!! giveaway 1h 2 #giveaway Discord Nitro Classic
    if (cmd === "giveaway") {
      const durStr  = args[0];
      const winners = parseInt(args[1]) || 1;
      const chMention = args[2];
      const prize   = args.slice(3).join(" ");

      if (!durStr || !prize) {
        return msg.reply({ embeds: [errEmbed(`Format: \`${OWNER_PREFIX}giveaway <durasi> <pemenang> <#channel> <hadiah>\`\nContoh: \`${OWNER_PREFIX}giveaway 1h 1 #giveaway Discord Nitro\``)] });
      }

      const ms = parseDuration(durStr);
      if (!ms) return msg.reply({ embeds: [errEmbed("Durasi tidak valid. Contoh: `30m`, `1h`, `2d`")] });

      const targetCh = msg.mentions.channels.first()
        || (CONFIG.GIVEAWAY_CHANNEL_ID ? msg.guild.channels.cache.get(CONFIG.GIVEAWAY_CHANNEL_ID) : null)
        || msg.channel;

      const endsAt = Date.now() + ms;
      const gwData = { prize, winners: Math.min(winners, 20), req: null, desc: null, endsAt, entries: new Set(), ended: false, hostId: msg.author.id, channelId: targetCh.id };

      const gwMsg = await targetCh.send({ embeds: [buildGiveawayEmbed(gwData)], components: [giveawayRow("placeholder")] });
      gwData.messageId = gwMsg.id;
      giveaways.set(gwMsg.id, gwData);
      await gwMsg.edit({ components: [giveawayRow(gwMsg.id)] });

      if (msg.channel.id !== targetCh.id)
        await msg.reply({ embeds: [okEmbed(`Giveaway **${prize}** dimulai di ${targetCh}!`)] });
      else
        await msg.delete().catch(() => {});

      log(msg.guild, "🎁 Giveaway Dibuat", `**${prize}** oleh ${msg.author.tag}`, msg.author, CONFIG.VIOLET);
      scheduleGiveawayEnd(gwMsg.id, gwData);
      return;
    }

    // cch!! giveawayend <messageId>
    if (cmd === "giveawayend") {
      const gw = giveaways.get(args[0]);
      if (!gw) return msg.reply({ embeds: [errEmbed("Giveaway tidak ditemukan.")] });
      await endGiveaway(args[0], gw, msg.guild);
      await msg.reply({ embeds: [okEmbed("Giveaway diakhiri.")] });
      return;
    }

    // cch!! reroll <messageId>
    if (cmd === "reroll") {
      const gw = giveaways.get(args[0]);
      if (!gw || !gw.ended) return msg.reply({ embeds: [errEmbed("Giveaway belum/tidak ditemukan.")] });
      await rerollGiveaway(args[0], gw, msg.guild);
      await msg.reply({ embeds: [okEmbed("Reroll selesai!")] });
      return;
    }

    // cch!! setverify <#channel>
    if (cmd === "setverify") {
      const ch = msg.mentions.channels.first();
      if (!ch) return msg.reply({ embeds: [errEmbed(`Contoh: \`${OWNER_PREFIX}setverify #verify-female\``)] });
      CONFIG.VERIFY_CHANNEL_ID = ch.id;
      return msg.reply({ embeds: [okEmbed(`Channel verify diset ke ${ch}.`)] });
    }

    // cch!! setlog <#channel>
    if (cmd === "setlog") {
      const ch = msg.mentions.channels.first();
      if (!ch) return msg.reply({ embeds: [errEmbed(`Contoh: \`${OWNER_PREFIX}setlog #log-admin\``)] });
      CONFIG.LOG_CHANNEL_ID = ch.id;
      return msg.reply({ embeds: [okEmbed(`Channel log diset ke ${ch}.`)] });
    }

    // cch!! announce <#channel> <pesan>
    if (cmd === "announce") {
      const ch = msg.mentions.channels.first();
      const text = args.slice(1).join(" ");
      if (!ch || !text) return msg.reply({ embeds: [errEmbed(`Format: \`${OWNER_PREFIX}announce #channel pesan\``)] });
      await ch.send({
        embeds: [new EmbedBuilder().setColor(CONFIG.PINK).setDescription(`📢  ${text}`).setFooter({ text: `Dari ${msg.author.tag}` }).setTimestamp()]
      });
      await msg.delete().catch(() => {});
      return;
    }

    // cch!! ownerhelp
    if (cmd === "ownerhelp") {
      return msg.reply({ embeds: [ownerHelpEmbed()] });
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  STAFF COMMANDS  (cch! <cmd>)
  // ══════════════════════════════════════════════════════════════
  if (level === "staff") {
    if (!isStaff(msg.member)) {
      return msg.reply({ embeds: [errEmbed("Hanya staff yang bisa menggunakan perintah ini.")] });
    }

    // cch! approve @user [alasan]
    if (cmd === "approve") {
      const target = msg.mentions.members.first();
      if (!target) return msg.reply({ embeds: [errEmbed(`Format: \`${STAFF_PREFIX}approve @user\``)] });
      if (CONFIG.FEMALE_ROLE_ID) await target.roles.add(CONFIG.FEMALE_ROLE_ID).catch(() => {});
      await msg.reply({ embeds: [okEmbed(`${target} telah diverifikasi sebagai Female Member.`)] });
      dmUser(target, msg.guild.name, true);
      log(msg.guild, "✅ Approved (manual)", `${target.user.tag} oleh ${msg.author.tag}`, target.user, CONFIG.SUCCESS);
      return;
    }

    // cch! reject @user <alasan>
    if (cmd === "reject") {
      const target = msg.mentions.members.first();
      const reason = args.slice(1).join(" ") || "Tidak memenuhi syarat.";
      if (!target) return msg.reply({ embeds: [errEmbed(`Format: \`${STAFF_PREFIX}reject @user alasan\``)] });
      await msg.reply({ embeds: [new EmbedBuilder().setColor(CONFIG.DANGER).setDescription(`${target} ditolak.\n**Alasan:** ${reason}`)] });
      dmUser(target, msg.guild.name, false, reason);
      log(msg.guild, "❌ Rejected (manual)", `${target.user.tag}\n**Alasan:** ${reason}`, target.user, CONFIG.DANGER);
      return;
    }

    // cch! closeticket
    if (cmd === "closeticket") {
      if (!msg.channel.name.startsWith("verifyfemale-")) {
        return msg.reply({ embeds: [errEmbed("Perintah ini hanya bisa dipakai di dalam ticket channel.")] });
      }
      await msg.reply({ embeds: [new EmbedBuilder().setColor(CONFIG.DANGER).setDescription("🔒 Menutup ticket dalam 5 detik…")] });
      setTimeout(() => msg.channel.delete().catch(() => {}), 5000);
      return;
    }

    // cch! tickets
    if (cmd === "tickets") {
      const tickets = msg.guild.channels.cache.filter(c => c.name.startsWith("verifyfemale-"));
      const list = tickets.size ? tickets.map(c => `${c}`).join("\n") : "Tidak ada ticket aktif.";
      return msg.reply({ embeds: [new EmbedBuilder().setColor(CONFIG.VIOLET).setTitle(`✦ Ticket Aktif (${tickets.size})`).setDescription(list)] });
    }

    // cch! staffhelp
    if (cmd === "staffhelp") {
      return msg.reply({ embeds: [staffHelpEmbed()] });
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  USER COMMANDS  (cch <cmd>)
  // ══════════════════════════════════════════════════════════════
  if (level === "user") {

    // cchhelp
    if (cmd === "help") {
      return msg.reply({ embeds: [userHelpEmbed()] });
    }

    // cchping
    if (cmd === "ping") {
      return msg.reply({ embeds: [okEmbed(`Pong! 🏓 Latency: \`${client.ws.ping}ms\``)] });
    }

    // cchstatus — cek status verify sendiri
    if (cmd === "status") {
      const ticket = msg.guild.channels.cache.find(
        c => c.name === `verifyfemale-${msg.author.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18)}`
      );
      const hasRole = CONFIG.FEMALE_ROLE_ID && msg.member.roles.cache.has(CONFIG.FEMALE_ROLE_ID);

      const embed = new EmbedBuilder()
        .setColor(hasRole ? CONFIG.SUCCESS : CONFIG.GOLD)
        .setTitle("✦ Status Verifikasimu")
        .addFields(
          { name: "Role Female", value: hasRole ? "✅ Sudah punya" : "❌ Belum", inline: true },
          { name: "Ticket Aktif", value: ticket ? `${ticket}` : "Tidak ada", inline: true },
        )
        .setFooter({ text: msg.author.tag });
      return msg.reply({ embeds: [embed] });
    }

    // cchinfo
    if (cmd === "info") {
      return msg.reply({
        embeds: [new EmbedBuilder()
          .setColor(CONFIG.PINK)
          .setTitle("✦ Info Bot")
          .setDescription("Bot verifikasi female & giveaway untuk komuniti ini.")
          .addFields(
            { name: "Prefix Umum", value: `\`${PREFIX}\``, inline: true },
            { name: "Prefix Staff", value: `\`${STAFF_PREFIX}\``, inline: true },
            { name: "Prefix Owner", value: `\`${OWNER_PREFIX}\``, inline: true },
            { name: "Perintah", value: `\`${PREFIX}help\` untuk daftar lengkap` },
          )
          .setFooter({ text: "Cosmic Corner Helper" })
        ]
      });
    }
  }
});

// ══════════════════════════════════════════════════════════════════
//  BUTTON & MODAL INTERACTIONS
// ══════════════════════════════════════════════════════════════════
client.on("interactionCreate", async (interaction) => {

  // ── BUTTON: open_verify_ticket ─────────────────────────────────
  if (interaction.isButton() && interaction.customId === "open_verify_ticket") {
    const { guild, user } = interaction;
    const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18) || user.id.slice(-6);
    const chName   = `verifyfemale-${safeName}`;

    const existing = guild.channels.cache.find(c => c.name === chName);
    if (existing)
      return interaction.reply({ content: `Kamu sudah punya ticket di ${existing}!`, ephemeral: true });

    const ch = await guild.channels.create({
      name: chName,
      type: ChannelType.GuildText,
      parent: CONFIG.TICKET_CATEGORY_ID || null,
      permissionOverwrites: [
        { id: guild.roles.everyone,  deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ...(CONFIG.STAFF_ROLE_ID ? [{
          id: CONFIG.STAFF_ROLE_ID,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
        }] : []),
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
      ],
      topic: `ticket:${user.id}`,
    });

    await ch.send({
      content: `${user}${CONFIG.STAFF_ROLE_ID ? ` <@&${CONFIG.STAFF_ROLE_ID}>` : ""}`,
      embeds: [buildTicketWelcome(user)],
      components: [ticketActionRow()],
    });

    await interaction.reply({ content: `✦ Ticket dibuat → ${ch}`, ephemeral: true });
    log(guild, "🎫 Ticket Dibuat", `${user.tag} membuka ticket\nChannel: \`${chName}\``, user, CONFIG.PINK);
  }

  // ── BUTTON: verify_faq ─────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "verify_faq") {
    await interaction.reply({ embeds: [buildFAQ()], ephemeral: true });
  }

  // ── BUTTON: fill_verify_form ───────────────────────────────────
  if (interaction.isButton() && interaction.customId === "fill_verify_form") {
    const modal = new ModalBuilder().setCustomId("verify_modal").setTitle("✦ Form Verifikasi Female");
    modal.addComponents(
      r1(new TextInputBuilder().setCustomId("nm").setLabel("Nama Panggilan").setStyle(TextInputStyle.Short).setPlaceholder("Nadia, Rara, dll").setRequired(true).setMaxLength(30)),
      r1(new TextInputBuilder().setCustomId("age").setLabel("Usia (min. 17)").setStyle(TextInputStyle.Short).setPlaceholder("21").setRequired(true).setMaxLength(3)),
      r1(new TextInputBuilder().setCustomId("sm").setLabel("Sosial Media Aktif (opsional)").setStyle(TextInputStyle.Short).setPlaceholder("@username").setRequired(false).setMaxLength(50)),
      r1(new TextInputBuilder().setCustomId("why").setLabel("Kenapa ingin jadi Female Member?").setStyle(TextInputStyle.Paragraph).setPlaceholder("Ceritain dikit tentang kamu…").setRequired(true).setMaxLength(350)),
    );
    await interaction.showModal(modal);
  }

  // ── MODAL: verify_modal ────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === "verify_modal") {
    const nm  = interaction.fields.getTextInputValue("nm");
    const age = interaction.fields.getTextInputValue("age");
    const sm  = interaction.fields.getTextInputValue("sm") || "—";
    const why = interaction.fields.getTextInputValue("why");

    if (isNaN(+age) || +age < 17 || +age > 80)
      return interaction.reply({ content: "✗ Usia tidak valid (min. 17).", ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(CONFIG.GOLD)
      .setTitle("✦ Permohonan Verifikasi")
      .setDescription(`> Menunggu tinjauan staff  •  <t:${Math.floor(Date.now()/1000)}:R>`)
      .addFields(
        { name: "👤  Nama",   value: nm,           inline: true },
        { name: "🎂  Usia",   value: `${age} tahun`, inline: true },
        { name: "📱  Sosmed", value: sm,            inline: true },
        { name: "💬  Alasan", value: why },
      )
      .setFooter({ text: `ID ${interaction.user.id}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`apv_${interaction.user.id}`).setLabel("Approve ✓").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`rej_${interaction.user.id}`).setLabel("Reject ✗").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("close_ticket").setLabel("Tutup Ticket").setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ embeds: [embed], components: [row] });
    log(interaction.guild, "📋 Form Masuk", `${interaction.user.tag}\n**Nama:** ${nm} | **Usia:** ${age}`, interaction.user, CONFIG.GOLD);
  }

  // ── BUTTON: approve ────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("apv_")) {
    if (!isStaff(interaction.member))
      return interaction.reply({ content: "✗ Staff only.", ephemeral: true });

    const uid = interaction.customId.slice(4);
    const mem = await interaction.guild.members.fetch(uid).catch(() => null);
    if (mem && CONFIG.FEMALE_ROLE_ID) await mem.roles.add(CONFIG.FEMALE_ROLE_ID).catch(() => {});

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setColor(CONFIG.SUCCESS)
        .setTitle("✦ Verifikasi Berhasil")
        .setDescription(`${mem ?? `<@${uid}>`} telah **diverifikasi** sebagai Female Member 🌸\n\n> Disetujui oleh ${interaction.user}`)
        .setTimestamp()],
      components: [],
    });
    if (mem) dmUser(mem, interaction.guild.name, true);
    log(interaction.guild, "✅ Approved", `${mem?.user.tag ?? uid} oleh ${interaction.user.tag}`, mem?.user, CONFIG.SUCCESS);
    setTimeout(() => interaction.channel.delete().catch(() => {}), 12000);
  }

  // ── BUTTON: reject ─────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("rej_")) {
    if (!isStaff(interaction.member))
      return interaction.reply({ content: "✗ Staff only.", ephemeral: true });

    const uid = interaction.customId.slice(4);
    const modal = new ModalBuilder().setCustomId(`rej_reason_${uid}`).setTitle("✦ Alasan Penolakan");
    modal.addComponents(r1(new TextInputBuilder().setCustomId("reason").setLabel("Alasan (akan dikirim ke user)").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)));
    await interaction.showModal(modal);
  }

  // ── MODAL: reject reason ───────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith("rej_reason_")) {
    const uid    = interaction.customId.split("_")[2];
    const reason = interaction.fields.getTextInputValue("reason");
    const mem    = await interaction.guild.members.fetch(uid).catch(() => null);

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(CONFIG.DANGER)
        .setTitle("✦ Verifikasi Ditolak")
        .setDescription(`**Alasan:** ${reason}\n\n> Ditolak oleh ${interaction.user} • Bisa coba lagi 7 hari lagi`)
        .setTimestamp()],
      components: [],
    });
    if (mem) dmUser(mem, interaction.guild.name, false, reason);
    log(interaction.guild, "❌ Rejected", `${mem?.user.tag ?? uid}\n**Alasan:** ${reason}`, mem?.user, CONFIG.DANGER);
    setTimeout(() => interaction.channel.delete().catch(() => {}), 12000);
  }

  // ── BUTTON: close_ticket ───────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "close_ticket") {
    const isOwnerOrStaff = isOwner(interaction.user.id) || isStaff(interaction.member);
    const isTicketOwner  = interaction.channel.topic?.includes(interaction.user.id);
    if (!isOwnerOrStaff && !isTicketOwner)
      return interaction.reply({ content: "✗ Kamu tidak bisa menutup ticket ini.", ephemeral: true });

    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(CONFIG.DANGER).setDescription("🔒 Menutup ticket dalam **5 detik**…")],
    });
    log(interaction.guild, "🔒 Ticket Tutup", `Ditutup oleh ${interaction.user.tag}`, interaction.user, CONFIG.DANGER);
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }

  // ── BUTTON: giveaway_join ──────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("gw_join_")) {
    const msgId = interaction.customId.slice(8);
    const gw    = giveaways.get(msgId);
    if (!gw || gw.ended)
      return interaction.reply({ content: "✗ Giveaway sudah berakhir.", ephemeral: true });

    if (gw.entries.has(interaction.user.id)) {
      gw.entries.delete(interaction.user.id);
      await updateGiveawayEmbed(msgId, gw, interaction.guild);
      return interaction.reply({ content: "↩ Kamu membatalkan keikutsertaan.", ephemeral: true });
    }
    gw.entries.add(interaction.user.id);
    await updateGiveawayEmbed(msgId, gw, interaction.guild);
    return interaction.reply({ content: "🎉 Kamu ikut giveaway! Good luck~", ephemeral: true });
  }
});

// ══════════════════════════════════════════════════════════════════
//  GIVEAWAY HELPERS
// ══════════════════════════════════════════════════════════════════
function parseDuration(str) {
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const m   = str.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return null;
  const ms = parseInt(m[1]) * map[m[2]];
  return ms >= 10000 ? ms : null;
}

function scheduleGiveawayEnd(msgId, gw) {
  const delay = gw.endsAt - Date.now();
  if (delay <= 0) return;
  setTimeout(async () => {
    const guild = client.guilds.cache.first();
    if (guild) await endGiveaway(msgId, gw, guild);
  }, delay);
}

async function endGiveaway(msgId, gw, guild) {
  if (gw.ended) return;
  gw.ended = true;
  const ch = guild.channels.cache.get(gw.channelId);
  if (!ch) return;
  const msg     = await ch.messages.fetch(msgId).catch(() => null);
  const winners = pickWinners(gw);

  const e = new EmbedBuilder()
    .setColor(CONFIG.GOLD)
    .setTitle("🎊 Giveaway Berakhir!")
    .setDescription(
      `**Hadiah:** ${gw.prize}\n\n` +
      (winners.length ? `**Pemenang:**\n${winners.map(id => `<@${id}>`).join("\n")}` : "Tidak ada peserta 😢")
    )
    .addFields({ name: "Total Peserta", value: `${gw.entries.size}`, inline: true })
    .setTimestamp();

  if (msg) await msg.edit({ embeds: [e], components: [] }).catch(() => {});
  if (winners.length)
    await ch.send({ content: `🎉 Selamat ${winners.map(id => `<@${id}>`).join(" ")}! Kamu menang **${gw.prize}**! Hubungi <@${gw.hostId}> untuk klaim. 🌸` });

  log(guild, "🏆 Giveaway Selesai", `**${gw.prize}**\n${winners.map(id => `<@${id}>`).join(", ") || "—"}`, null, CONFIG.GOLD);
}

async function rerollGiveaway(msgId, gw, guild) {
  const ch      = guild.channels.cache.get(gw.channelId);
  const winners = pickWinners(gw);
  await ch?.send({
    content: winners.length
      ? `🔄 **Reroll!** Pemenang baru: ${winners.map(id => `<@${id}>`).join(" ")} 🎉`
      : "Tidak ada peserta tersisa.",
  });
}

function pickWinners(gw) {
  const pool  = [...gw.entries];
  const count = Math.min(gw.winners, pool.length);
  const out   = [];
  while (out.length < count) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

async function updateGiveawayEmbed(msgId, gw, guild) {
  const ch  = guild.channels.cache.get(gw.channelId);
  const msg = await ch?.messages.fetch(msgId).catch(() => null);
  if (msg) await msg.edit({ embeds: [buildGiveawayEmbed(gw)], components: [giveawayRow(msgId)] }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════════
//  EMBED BUILDERS
// ══════════════════════════════════════════════════════════════════
function buildVerifyPanel() {
  return new EmbedBuilder()
    .setColor(CONFIG.PINK)
    .setTitle("✦ Verifikasi Female Member")
    .setDescription("Selamat datang! Untuk mendapatkan akses **Female Member**, ikuti langkah berikut:\n\u200b")
    .addFields(
      { name: "① Buka Ticket",  value: "Klik tombol di bawah untuk membuat ticket privat.", inline: false },
      { name: "② Isi Form",     value: "Jawab beberapa pertanyaan singkat di dalam ticket.", inline: false },
      { name: "③ Tunggu Review",value: "Staff akan meninjau & memberi keputusan dalam 30 menit.", inline: false },
      { name: "④ Dapat Role",   value: "Jika disetujui, role **Female** otomatis diberikan. 🌸", inline: false },
      { name: "\u200b",         value: "**⚠ Catatan:** Fake identity = ban permanen." },
    )
    .setFooter({ text: `✦ Cosmic Corner Helper  •  Ketik ${PREFIX}help untuk bantuan` })
    .setTimestamp();
}

function buildTicketWelcome(user) {
  return new EmbedBuilder()
    .setColor(CONFIG.VIOLET)
    .setTitle(`✦ Ticket — ${user.username}`)
    .setDescription(`Halo ${user}! 🌸\n\nTicket ini hanya terlihat oleh kamu dan staff.\nKlik **Isi Form** untuk memulai proses verifikasi.\n\u200b`)
    .addFields({ name: "Status", value: "```\n⏳  Menunggu pengisian form\n```" })
    .setFooter({ text: `ID: ${user.id}` })
    .setTimestamp();
}

function buildFAQ() {
  return new EmbedBuilder()
    .setColor(CONFIG.VIOLET)
    .setTitle("✦ FAQ Verifikasi")
    .addFields(
      { name: "Kenapa perlu verifikasi?", value: "Menjaga keamanan & kenyamanan female member." },
      { name: "Data apa yang diminta?",   value: "Hanya nama, usia, sosmed (opsional), alasan. Tidak ada foto." },
      { name: "Berapa lama prosesnya?",   value: "5–30 menit tergantung ketersediaan staff." },
      { name: "Kalau ditolak?",           value: "Bisa mencoba kembali setelah 7 hari." },
    )
    .setFooter({ text: "Masih bingung? Hubungi staff kami." });
}

function buildGiveawayEmbed(gw) {
  const timeLeft = gw.ended ? "Selesai" : `<t:${Math.floor(gw.endsAt/1000)}:R>`;
  return new EmbedBuilder()
    .setColor(gw.ended ? CONFIG.GOLD : CONFIG.VIOLET)
    .setTitle(`🎁  ${gw.prize}`)
    .setDescription((gw.desc ? `${gw.desc}\n\n` : "") + "Klik tombol **Ikut Giveaway** untuk masuk undian!\n\u200b")
    .addFields(
      { name: "⏰  Berakhir", value: timeLeft,        inline: true },
      { name: "🏆  Pemenang", value: `${gw.winners}`, inline: true },
      { name: "👥  Peserta",  value: `${gw.entries.size}`, inline: true },
      ...(gw.req ? [{ name: "📌  Syarat", value: gw.req }] : []),
    )
    .setFooter({ text: `Host: ${gw.hostId}  •  Tekan tombol untuk ikut/batal` })
    .setTimestamp();
}

// ══════════════════════════════════════════════════════════════════
//  HELP EMBEDS
// ══════════════════════════════════════════════════════════════════
function userHelpEmbed() {
  return new EmbedBuilder()
    .setColor(CONFIG.PINK)
    .setTitle("✦ Daftar Perintah")
    .setDescription(`Prefix: \`${PREFIX}\``)
    .addFields(
      { name: `\`${PREFIX}help\``,   value: "Tampilkan bantuan ini" },
      { name: `\`${PREFIX}ping\``,   value: "Cek latensi bot" },
      { name: `\`${PREFIX}status\``, value: "Cek status verifikasimu" },
      { name: `\`${PREFIX}info\``,   value: "Info bot & prefix" },
    )
    .setFooter({ text: `Staff? Ketik ${STAFF_PREFIX}staffhelp` });
}

function staffHelpEmbed() {
  return new EmbedBuilder()
    .setColor(CONFIG.VIOLET)
    .setTitle("✦ Perintah Staff")
    .setDescription(`Prefix: \`${STAFF_PREFIX}\``)
    .addFields(
      { name: `\`${STAFF_PREFIX}approve @user\``,         value: "Approve verifikasi manual" },
      { name: `\`${STAFF_PREFIX}reject @user [alasan]\``, value: "Reject verifikasi dengan alasan" },
      { name: `\`${STAFF_PREFIX}closeticket\``,           value: "Tutup ticket yang sedang dibuka" },
      { name: `\`${STAFF_PREFIX}tickets\``,               value: "Lihat semua ticket aktif" },
      { name: `\`${STAFF_PREFIX}staffhelp\``,             value: "Tampilkan daftar ini" },
    )
    .setFooter({ text: `Owner? Ketik ${OWNER_PREFIX}ownerhelp` });
}

function ownerHelpEmbed() {
  return new EmbedBuilder()
    .setColor(CONFIG.GOLD)
    .setTitle("✦ Perintah Owner")
    .setDescription(`Prefix: \`${OWNER_PREFIX}\``)
    .addFields(
      { name: `\`${OWNER_PREFIX}verifysetup\``,                               value: "Pasang panel verify di channel ini" },
      { name: `\`${OWNER_PREFIX}giveaway <durasi> <pemenang> <#ch> <hadiah>\``, value: "Buat giveaway baru\nContoh: `cch!! giveaway 1h 1 #giveaway Nitro`" },
      { name: `\`${OWNER_PREFIX}giveawayend <messageId>\``,                   value: "Akhiri giveaway lebih cepat" },
      { name: `\`${OWNER_PREFIX}reroll <messageId>\``,                        value: "Pilih ulang pemenang giveaway" },
      { name: `\`${OWNER_PREFIX}setverify <#channel>\``,                      value: "Set channel verify" },
      { name: `\`${OWNER_PREFIX}setlog <#channel>\``,                         value: "Set channel log" },
      { name: `\`${OWNER_PREFIX}announce <#channel> <pesan>\``,               value: "Kirim pengumuman" },
      { name: `\`${OWNER_PREFIX}ownerhelp\``,                                 value: "Tampilkan daftar ini" },
    )
    .setFooter({ text: "⚠ Perintah owner bersifat sensitif." });
}

// ══════════════════════════════════════════════════════════════════
//  COMPONENT BUILDERS
// ══════════════════════════════════════════════════════════════════
function verifyPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("open_verify_ticket").setLabel("✦ Verify Sekarang").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("verify_faq").setLabel("FAQ").setStyle(ButtonStyle.Secondary),
  );
}

function ticketActionRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("fill_verify_form").setLabel("📝 Isi Form").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("close_ticket").setLabel("🔒 Tutup").setStyle(ButtonStyle.Danger),
  );
}

function giveawayRow(msgId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw_join_${msgId}`).setLabel("🎉 Ikut Giveaway").setStyle(ButtonStyle.Primary),
  );
}

function r1(input) { return new ActionRowBuilder().addComponents(input); }

// ══════════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════════
function isOwner(userId)   { return CONFIG.OWNER_IDS.includes(userId); }
function isStaff(member)   {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (CONFIG.STAFF_ROLE_ID && member.roles.cache.has(CONFIG.STAFF_ROLE_ID)) return true;
  return false;
}

function okEmbed(desc)  { return new EmbedBuilder().setColor(CONFIG.SUCCESS).setDescription(`✓  ${desc}`); }
function errEmbed(desc) { return new EmbedBuilder().setColor(CONFIG.DANGER).setDescription(`✗  ${desc}`); }

async function log(guild, title, desc, user, color) {
  if (!CONFIG.LOG_CHANNEL_ID) return;
  const ch = guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
  if (!ch) return;
  await ch.send({
    embeds: [new EmbedBuilder()
      .setColor(color).setTitle(title).setDescription(desc)
      .setThumbnail(user?.displayAvatarURL?.() ?? null)
      .setFooter({ text: `ID: ${user?.id ?? "—"}` })
      .setTimestamp()]
  }).catch(() => {});
}

async function dmUser(member, serverName, approved, reason = null) {
  await member.send({
    embeds: [new EmbedBuilder()
      .setColor(approved ? CONFIG.SUCCESS : CONFIG.DANGER)
      .setTitle(approved ? "✦ Verifikasi Berhasil!" : "✦ Verifikasi Ditolak")
      .setDescription(
        approved
          ? `Halo ${member.displayName}! 🌸\n\nKamu resmi jadi **Female Member** di **${serverName}**!`
          : `Maaf ${member.displayName},\n\nPermohonanmu di **${serverName}** ditolak.\n\n**Alasan:** ${reason}\n\nCoba lagi setelah 7 hari.`
      )
      .setFooter({ text: serverName })]
  }).catch(() => {});
}

client.login(process.env.DISCORD_TOKEN);
