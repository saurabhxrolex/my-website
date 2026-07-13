import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from "baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";

const BOT_NAME = "David Bot";
const OWNER_NAME = "David";
const PREFIX = ".";
const AUTH_FOLDER = "./auth_info";

const BAD_WORDS = [
  "madarchod",
  "maderchod",
  "bhenchod",
  "behenchod",
  "benchod",
  "chutiya",
  "chutia",
  "gandu",
  "randi",
  "lund",
  "lauda",
  "loda",
  "bhosdike",
  "bhosdi",
  "harami",
  "kamina",
  "kutiya",
  "mc",
  "bc"
];

const LINK_REGEX =
  /(https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+|t\.me\/[^\s]+|telegram\.me\/[^\s]+|instagram\.com\/[^\s]+|facebook\.com\/[^\s]+|youtu\.be\/[^\s]+|youtube\.com\/[^\s]+)/i;

function unwrapMessage(rawMessage) {
  if (!rawMessage) return {};

  if (rawMessage.ephemeralMessage?.message) {
    return unwrapMessage(rawMessage.ephemeralMessage.message);
  }

  if (rawMessage.viewOnceMessage?.message) {
    return unwrapMessage(rawMessage.viewOnceMessage.message);
  }

  if (rawMessage.viewOnceMessageV2?.message) {
    return unwrapMessage(rawMessage.viewOnceMessageV2.message);
  }

  if (rawMessage.documentWithCaptionMessage?.message) {
    return unwrapMessage(
      rawMessage.documentWithCaptionMessage.message
    );
  }

  return rawMessage;
}

function getMessageText(rawMessage) {
  const message = unwrapMessage(rawMessage);

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ""
  );
}

function normalizeText(text = "") {
  return text
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/[@._\-*~`'"\s]/g, "");
}

function containsBadWord(text) {
  const normalizedMessage = normalizeText(text);

  return BAD_WORDS.some((word) => {
    const normalizedWord = normalizeText(word);

    if (normalizedWord.length <= 2) {
      const escapedWord = word.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      const shortWordRegex = new RegExp(
        `(^|\\s|[^a-zA-Z])${escapedWord}($|\\s|[^a-zA-Z])`,
        "i"
      );

      return shortWordRegex.test(text);
    }

    return normalizedMessage.includes(normalizedWord);
  });
}

function containsLink(text) {
  return LINK_REGEX.test(text);
}

function isGroup(jid = "") {
  return jid.endsWith("@g.us");
}

function getSender(message) {
  return (
    message.key.participant ||
    message.participant ||
    message.key.remoteJid
  );
}

function getNumber(jid = "") {
  return jid.split("@")[0].split(":")[0];
}

async function getGroupPermissions(
  sock,
  groupId,
  senderJid
) {
  try {
    const metadata = await sock.groupMetadata(groupId);
    const participants = metadata.participants || [];

    const senderNumber = getNumber(senderJid);
    const botNumber = getNumber(sock.user?.id || "");

    const senderData = participants.find((participant) => {
      const participantNumber = getNumber(
        participant.id || participant.lid || ""
      );

      return participantNumber === senderNumber;
    });

    const botData = participants.find((participant) => {
      const participantNumber = getNumber(
        participant.id || participant.lid || ""
      );

      return participantNumber === botNumber;
    });

    const senderIsAdmin =
      senderData?.admin === "admin" ||
      senderData?.admin === "superadmin";

    const botIsAdmin =
      botData?.admin === "admin" ||
      botData?.admin === "superadmin";

    return {
      senderIsAdmin,
      botIsAdmin
    };
  } catch (error) {
    console.log(
      "Group permission error:",
      error.message
    );

    return {
      senderIsAdmin: false,
      botIsAdmin: false
    };
  }
}

async function deleteMessage(
  sock,
  groupId,
  message
) {
  try {
    await sock.sendMessage(groupId, {
      delete: message.key
    });

    return true;
  } catch (error) {
    console.log(
      "Message delete failed:",
      error.message
    );

    return false;
  }
}

async function sendWarning(
  sock,
  groupId,
  sender,
  reason
) {
  const number = getNumber(sender);

  await sock.sendMessage(groupId, {
    text:
      `⚠️ Warning @${number}\n\n` +
      `${reason}\n\n` +
      `Member ko group se remove nahi kiya gaya.`,
    mentions: [sender]
  });
}

async function moderateMessage(
  sock,
  message
) {
  const groupId = message.key.remoteJid;

  if (!isGroup(groupId)) return false;
  if (message.key.fromMe) return false;

  const sender = getSender(message);
  if (!sender) return false;

  const text = getMessageText(message.message);
  if (!text) return false;

  const {
    senderIsAdmin,
    botIsAdmin
  } = await getGroupPermissions(
    sock,
    groupId,
    sender
  );

  // Admin ke messages delete nahi honge
  if (senderIsAdmin) return false;


  if (containsLink(text)) {
    const deleted = await deleteMessage(
      sock,
      groupId,
      message
    );

    if (deleted) {
      await sendWarning(
        sock,
        groupId,
        sender,
        "Group mein link bhejna allowed nahi hai."
      );
    }

    return true;
  }

  if (containsBadWord(text)) {
    const deleted = await deleteMessage(
      sock,
      groupId,
      message
    );

    if (deleted) {
      await sendWarning(
        sock,
        groupId,
        sender,
        "Group mein abusive language allowed nahi hai."
      );
    }

    return true;
  }

  return false;
}

async function handleCommand(
  sock,
  message
) {
  const chatId = message.key.remoteJid;
  const text = getMessageText(message.message);

  if (!text.startsWith(PREFIX)) return;

  const parts = text
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/);

  const command = parts.shift()?.toLowerCase();

  switch (command) {
    case "ping":
      await sock.sendMessage(chatId, {
        text: "🏓 Pong! David Bot working."
      });
      break;

    case "status":
      await sock.sendMessage(chatId, {
        text:
          `🤖 ${BOT_NAME} Status\n\n` +
          `✅ Anti-Link: Enabled\n` +
          `✅ Anti-Abuse: Enabled\n` +
          `✅ Auto Delete: Enabled\n` +
          `❌ Auto Remove: Disabled\n` +
          `👑 Owner: ${OWNER_NAME}`
      });
      break;

    case "menu":
    case "help":
      await sock.sendMessage(chatId, {
        text: `
╭━━『 ${BOT_NAME} 』━━╮

👑 Owner: ${OWNER_NAME}
⚡ Prefix: ${PREFIX}

🤖 COMMANDS
➜ ${PREFIX}ping
➜ ${PREFIX}menu
➜ ${PREFIX}status

🛡️ AUTO SECURITY
➜ Link auto-delete
➜ Abuse auto-delete
➜ Warning message
➜ Admin messages allowed

❌ Member auto-remove disabled

⚠️ Bot ko group admin banana zaroori hai.

╰━━━━━━━━━━━━━━━━╯
        `.trim()
      });
      break;

    default:
      break;
  }
}

let reconnectTimer = null;

async function startBot() {
  const {
    state,
    saveCreds
  } = await useMultiFileAuthState(
    AUTH_FOLDER
  );

  const { version } =
    await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,

    logger: pino({
      level: "silent"
    }),

    browser: [
      BOT_NAME,
      "Chrome",
      "1.0.0"
    ],

    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on(
    "creds.update",
    saveCreds
  );

  sock.ev.on(
    "connection.update",
    async (update) => {
      const {
        connection,
        lastDisconnect,
        qr
      } = update;

      if (qr) {
        console.clear();

        console.log(
          "WhatsApp > Linked devices > Link a device se QR scan karo:\n"
        );

        qrcode.generate(qr, {
          small: true
        });
      }

      if (connection === "open") {
        console.clear();

        console.log(
          `✅ ${BOT_NAME} connected successfully!`
        );

        console.log(
          "✅ Bot ko group admin banao."
        );
      }

      if (connection === "close") {
        const statusCode =
          lastDisconnect?.error
            ?.output?.statusCode ||
          lastDisconnect?.error
            ?.data?.statusCode;

        const loggedOut =
          statusCode ===
          DisconnectReason.loggedOut;

        console.log(
          "Connection closed:",
          statusCode
        );

        if (loggedOut) {
          console.log(
            "Session logout ho gayi."
          );

          console.log(
            "auth_info folder delete karke dobara QR scan karo."
          );

          return;
        }

        clearTimeout(reconnectTimer);

        reconnectTimer = setTimeout(() => {
          startBot().catch((error) => {
            console.log(
              "Reconnect failed:",
              error.message
            );
          });
        }, 3000);
      }
    }
  );

  sock.ev.on(
    "messages.upsert",
    async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const message of messages) {
        try {
          if (!message.message) continue;

          if (
            message.key.remoteJid ===
            "status@broadcast"
          ) {
            continue;
          }

          const moderated =
            await moderateMessage(
              sock,
              message
            );

          if (!moderated) {
            await handleCommand(
              sock,
              message
            );
          }
        } catch (error) {
          console.log(
            "Message handling error:",
            error.message
          );
        }
      }
    }
  );
}

startBot().catch((error) => {
  console.log(
    "Bot start error:",
    error
  );
});
