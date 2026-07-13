import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from "baileys";

import dotenv from "dotenv";
import pino from "pino";
import qrcode from "qrcode-terminal";

dotenv.config();

/* =========================================
   DAVID BOT SETTINGS
========================================= */

const BOT_NAME = "David Bot";
const OWNER_NAME = "David";
const PREFIX = ".";
const AUTH_FOLDER = "./auth_info";

const SIGHTENGINE_API_USER =
  process.env.SIGHTENGINE_API_USER || "";

const SIGHTENGINE_API_SECRET =
  process.env.SIGHTENGINE_API_SECRET || "";

/*
0.75 ka matlab 75% confidence.
*/
const NSFW_THRESHOLD = 0.75;

/* =========================================
   BAD WORDS
========================================= */

const BAD_WORDS = [
  "madarchod",
  "maderchod",
  "motherchod",
  "bhenchod",
  "behenchod",
  "benchod",
  "chutiya",
  "chutia",
  "gandu",
  "gaand",
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
  "madarchood",
"madrchod",
"maderchood",
"madarchod",
"bhenchoood",
"behenchoood",
"gaandu",
"gaanduu",
"mc",
"b.c",
"m.c",
"bsdk",
"mkc",
"bkl",
];

/* =========================================
   LINK DETECTION
========================================= */

const LINK_REGEX =
  /(https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+|t\.me\/[^\s]+|telegram\.me\/[^\s]+|instagram\.com\/[^\s]+|facebook\.com\/[^\s]+|youtu\.be\/[^\s]+|youtube\.com\/[^\s]+)/i;

/* =========================================
   MESSAGE HELPERS
========================================= */

function unwrapMessage(rawMessage) {
  if (!rawMessage) {
    return {};
  }

  if (rawMessage.ephemeralMessage?.message) {
    return unwrapMessage(
      rawMessage.ephemeralMessage.message
    );
  }

  if (rawMessage.viewOnceMessage?.message) {
    return unwrapMessage(
      rawMessage.viewOnceMessage.message
    );
  }

  if (rawMessage.viewOnceMessageV2?.message) {
    return unwrapMessage(
      rawMessage.viewOnceMessageV2.message
    );
  }

  if (
    rawMessage.viewOnceMessageV2Extension?.message
  ) {
    return unwrapMessage(
      rawMessage.viewOnceMessageV2Extension.message
    );
  }

  if (
    rawMessage.documentWithCaptionMessage?.message
  ) {
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

function getMediaType(rawMessage) {
  const message = unwrapMessage(rawMessage);

  if (message.imageMessage) {
    return "image";
  }

  if (message.stickerMessage) {
    return "sticker";
  }

  return "none";
}

function getMediaMimeType(rawMessage) {
  const message = unwrapMessage(rawMessage);

  if (message.imageMessage) {
    return (
      message.imageMessage.mimetype ||
      "image/jpeg"
    );
  }

  if (message.stickerMessage) {
    return (
      message.stickerMessage.mimetype ||
      "image/webp"
    );
  }

  return "application/octet-stream";
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
  return jid
    .split("@")[0]
    .split(":")[0];
}

/* =========================================
   ABUSE DETECTION
========================================= */

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
  const normalizedMessage =
    normalizeText(text);

  return BAD_WORDS.some((word) => {
    const normalizedWord =
      normalizeText(word);

    if (normalizedWord.length <= 2) {
      const escapedWord = word.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      const shortWordRegex =
        new RegExp(
          `(^|\\s|[^a-zA-Z])${escapedWord}($|\\s|[^a-zA-Z])`,
          "i"
        );

      return shortWordRegex.test(text);
    }

    return normalizedMessage.includes(
      normalizedWord
    );
  });
}

function containsLink(text) {
  return LINK_REGEX.test(text);
}

/* =========================================
   ADMIN CHECK
========================================= */

function participantMatchesSender(
  participant,
  senderJid
) {
  const senderNumber =
    getNumber(senderJid);

  const participantIds = [
    participant.id,
    participant.lid
  ].filter(Boolean);

  return participantIds.some((id) => {
    if (id === senderJid) {
      return true;
    }

    return (
      getNumber(id) === senderNumber
    );
  });
}

async function isSenderAdmin(
  sock,
  groupId,
  senderJid
) {
  try {
    const metadata =
      await sock.groupMetadata(groupId);

    const participant =
      metadata.participants?.find(
        (item) =>
          participantMatchesSender(
            item,
            senderJid
          )
      );

    return (
      participant?.admin === "admin" ||
      participant?.admin === "superadmin"
    );
  } catch (error) {
    console.log(
      "Admin check error:",
      error.message
    );

    return false;
  }
}

/* =========================================
   DELETE MESSAGE
========================================= */

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

/* =========================================
   WARNING MESSAGE
========================================= */

async function sendWarning(
  sock,
  groupId,
  sender,
  reason
) {
  try {
    const number = getNumber(sender);

    await sock.sendMessage(groupId, {
      text:
        `⚠️ Warning @${number}\n\n` +
        `${reason}\n\n` +
        `❌ Member ko group se remove nahi kiya gaya.`,
      mentions: [sender]
    });
  } catch (error) {
    console.log(
      "Warning failed:",
      error.message
    );
  }
}

/* =========================================
   IMAGE MODERATION
========================================= */

function imageModerationEnabled() {
  return Boolean(
    SIGHTENGINE_API_USER &&
    SIGHTENGINE_API_SECRET
  );
}

async function checkNsfwImage(
  mediaBuffer,
  mimeType
) {
  if (!imageModerationEnabled()) {
    return {
      enabled: false,
      unsafe: false,
      highestScore: 0
    };
  }

  const formData = new FormData();

  let extension = "jpg";

  if (mimeType.includes("webp")) {
    extension = "webp";
  } else if (mimeType.includes("png")) {
    extension = "png";
  } else if (mimeType.includes("gif")) {
    extension = "gif";
  }

  const mediaBlob = new Blob(
    [mediaBuffer],
    {
      type: mimeType
    }
  );

  formData.append(
    "media",
    mediaBlob,
    `whatsapp-media.${extension}`
  );

  formData.append(
    "models",
    "nudity-2.1"
  );

  formData.append(
    "api_user",
    SIGHTENGINE_API_USER
  );

  formData.append(
    "api_secret",
    SIGHTENGINE_API_SECRET
  );

  const response = await fetch(
    "https://api.sightengine.com/1.0/check.json",
    {
      method: "POST",
      body: formData
    }
  );

  if (!response.ok) {
    throw new Error(
      `Sightengine HTTP error: ${response.status}`
    );
  }

  const result = await response.json();

  if (result.status !== "success") {
    throw new Error(
      result.error?.message ||
      "Image checking failed"
    );
  }

  const nudity = result.nudity || {};

  const scores = {
    sexualActivity:
      nudity.sexual_activity || 0,

    sexualDisplay:
      nudity.sexual_display || 0,

    erotica:
      nudity.erotica || 0,

    verySuggestive:
      nudity.very_suggestive || 0
  };

  const highestScore = Math.max(
    ...Object.values(scores)
  );

  return {
    enabled: true,
    unsafe:
      highestScore >= NSFW_THRESHOLD,
    highestScore,
    scores
  };
}

async function moderateMedia(
  sock,
  message
) {
  const groupId =
    message.key.remoteJid;

  const mediaType =
    getMediaType(message.message);

  if (mediaType === "none") {
    return false;
  }

  if (!imageModerationEnabled()) {
    return false;
  }

  const sender = getSender(message);

  const senderIsAdmin =
    await isSenderAdmin(
      sock,
      groupId,
      sender
    );

  if (senderIsAdmin) {
    return false;
  }

  try {
    const mimeType =
      getMediaMimeType(message.message);

    const mediaBuffer =
      await downloadMediaMessage(
        message,
        "buffer",
        {},
        {
          logger: pino({
            level: "silent"
          }),

          reuploadRequest:
            sock.updateMediaMessage
        }
      );

    const result =
      await checkNsfwImage(
        mediaBuffer,
        mimeType
      );

    if (!result.unsafe) {
      return false;
    }

    const deleted =
      await deleteMessage(
        sock,
        groupId,
        message
      );

    if (!deleted) {
      return false;
    }

    const reason =
      mediaType === "sticker"
        ? "Adult ya inappropriate sticker group mein allowed nahi hai."
        : "Adult ya inappropriate photo group mein allowed nahi hai.";

    await sendWarning(
      sock,
      groupId,
      sender,
      reason
    );

    console.log(
      `${mediaType} deleted. Score:`,
      result.highestScore
    );

    return true;
  } catch (error) {
    console.log(
      "Media moderation error:",
      error.message
    );

    return false;
  }
}

/* =========================================
   TEXT MODERATION
========================================= */

async function moderateText(
  sock,
  message
) {
  const groupId =
    message.key.remoteJid;

  const sender =
    getSender(message);

  const text =
    getMessageText(message.message);

  if (!text) {
    return false;
  }

  const senderIsAdmin =
    await isSenderAdmin(
      sock,
      groupId,
      sender
    );

  // Group admin ke messages allow honge
  if (senderIsAdmin) {
    return false;
  }

  if (containsLink(text)) {
    const deleted =
      await deleteMessage(
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

    return deleted;
  }

  if (containsBadWord(text)) {
    const deleted =
      await deleteMessage(
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

    return deleted;
  }

  return false;
}

/* =========================================
   COMPLETE MODERATION
========================================= */

async function moderateMessage(
  sock,
  message
) {
  const groupId =
    message.key.remoteJid;

  if (!isGroup(groupId)) {
    return false;
  }

  if (message.key.fromMe) {
    return false;
  }

  const sender =
    getSender(message);

  if (!sender) {
    return false;
  }

  const mediaDeleted =
    await moderateMedia(
      sock,
      message
    );

  if (mediaDeleted) {
    return true;
  }

  return moderateText(
    sock,
    message
  );
}

/* =========================================
   COMMANDS
========================================= */

async function handleCommand(
  sock,
  message
) {
  const chatId =
    message.key.remoteJid;

  const text =
    getMessageText(message.message);

  if (!text.startsWith(PREFIX)) {
    return;
  }

  const parts = text
    .slice(PREFIX.length)
    .trim()
    .split(/\s+/);

  const command =
    parts.shift()?.toLowerCase();

  switch (command) {
    case "ping":
      await sock.sendMessage(chatId, {
        text:
          "🏓 Pong! David Bot working."
      });
      break;

    case "status": {
      const mediaStatus =
        imageModerationEnabled()
          ? "✅ Enabled"
          : "❌ API key required";

      await sock.sendMessage(chatId, {
        text:
          `🤖 ${BOT_NAME} Status\n\n` +
          `✅ Anti-Link: Enabled\n` +
          `✅ Anti-Abuse: Enabled\n` +
          `✅ Auto Delete: Enabled\n` +
          `🖼️ Photo/Sticker: ${mediaStatus}\n` +
          `❌ Auto Remove: Disabled\n` +
          `👑 Owner: ${OWNER_NAME}`
      });

      break;
    }

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
➜ Adult photo auto-delete
➜ Adult sticker auto-delete
➜ Warning message
➜ Admin messages allowed

❌ Member auto-remove disabled

⚠️ Bot account ko group admin banana zaroori hai.

╰━━━━━━━━━━━━━━━━╯
        `.trim()
      });
      break;

    default:
      break;
  }
}

/* =========================================
   BOT CONNECTION
========================================= */

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
    syncFullHistory: false,
    generateHighQualityLinkPreview: false
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
          "✅ Bot account ko group admin banao."
        );

        if (imageModerationEnabled()) {
          console.log(
            "✅ Photo/sticker moderation enabled."
          );
        } else {
          console.log(
            "⚠️ Photo/sticker API key nahi mili."
          );
        }
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

        reconnectTimer =
          setTimeout(() => {
            startBot().catch(
              (error) => {
                console.log(
                  "Reconnect failed:",
                  error.message
                );
              }
            );
          }, 3000);
      }
    }
  );

  sock.ev.on(
    "messages.upsert",
    async ({
      messages,
      type
    }) => {
      if (type !== "notify") {
        return;
      }

      for (const message of messages) {
        try {
          if (!message.message) {
            continue;
          }

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
