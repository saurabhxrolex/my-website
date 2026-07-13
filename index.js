import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";

const AUTH_FOLDER = "./auth_info";

const LINK_REGEX =
  /(https?:\/\/[^\s]+|www\.[^\s]+|chat\.whatsapp\.com\/[^\s]+|wa\.me\/[^\s]+|t\.me\/[^\s]+|instagram\.com\/[^\s]+|facebook\.com\/[^\s]+|youtube\.com\/[^\s]+|youtu\.be\/[^\s]+)/i;

function unwrapMessage(message) {
  if (!message) return null;

  return (
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message
  );
}

function getMessageText(rawMessage) {
  const message = unwrapMessage(rawMessage);

  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    ""
  );
}
function getStatusCode(error) {
  return (
    error?.output?.statusCode ||
    error?.data?.statusCode ||
    error?.statusCode ||
    null
  );
}

let reconnectTimer = null;

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState(AUTH_FOLDER);

  const { version } =
    await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: [
      "WhatsApp Anti-Link Bot",
      "Chrome",
      "1.0.0"
    ],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false
  });

  sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (update) => {
    const {
      connection,
      lastDisconnect,
      qr
    } = update;

    if (qr) {
      console.clear();

      console.log(
        "QR ko WhatsApp > Linked devices > Link a device se scan karo:\n"
      );

      qrcode.generate(qr, {
        small: true
      });

      console.log(
        "\nQR expire ho to naya QR automatically aayega."
      );
    }

    if (connection === "open") {
      console.clear();

      console.log(
        "✅ WhatsApp Anti-Link Bot connected!"
      );

      console.log(
        "✅ Bot number ko group ka admin banao."
      );
    }
          if (connection === "close") {
      const code = getStatusCode(lastDisconnect?.error);

      console.log("Disconnected:", code);

      if (
        code !== DisconnectReason.loggedOut &&
        code !== 401
      ) {
        clearTimeout(reconnectTimer);

        reconnectTimer = setTimeout(() => {
          startBot();
        }, 3000);
      } else {
        console.log(
          "Session logout ho gayi. auth_info delete karke dobara login karo."
        );
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages?.[0];

    if (!msg || msg.key.fromMe) return;

    const text = getMessageText(msg.message);

    if (!LINK_REGEX.test(text)) return;

    const jid = msg.key.remoteJid;

    if (!jid.endsWith("@g.us")) return;

    try {
      await sock.sendMessage(jid, {
        delete: msg.key
      });
    } catch (e) {
      console.log("Delete failed");
    }
  });
}
startBot().catch((error) => {
  console.error(
    "Bot start error:",
    error?.message || error
  );
});
