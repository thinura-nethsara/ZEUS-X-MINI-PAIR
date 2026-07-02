const express = require("express");
const fs = require("fs");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const qrcode = require("qrcode");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");

let router = express.Router();

// MongoDB Session Schema
const SessionSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  creds: { type: Object, required: true },
  added_at: { type: Date, default: Date.now }
});
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

function removeFile(FilePath) {
  if (fs.existsSync(FilePath)) {
    fs.rmSync(FilePath, { recursive: true, force: true });
  }
}

router.get("/", async (req, res) => {
  const uniqueSessionId = `qr-session-${uuidv4()}`;
  const sessionFolder = `./${uniqueSessionId}`;
  let qrSent = false;
  let timeoutId = null;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    
    const RobinQR = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          pino({ level: "fatal" }).child({ level: "fatal" })
        ),
      },
      printQRInTerminal: false,
      logger: pino({ level: "fatal" }).child({ level: "fatal" }),
      browser: Browsers.macOS("Safari"),
    });

    RobinQR.ev.on("connection.update", async (s) => {
      const { connection, qr, lastDisconnect } = s;

      if (qr && !qrSent) {
        qrSent = true;
        try {
          const qrImage = await qrcode.toDataURL(qr);
          
          if (!res.headersSent) {
            res.status(200).json({
              success: true,
              qr: qrImage,
              message: "Scan this QR code with WhatsApp mobile app",
              sessionId: uniqueSessionId
            });
          }
        } catch (qrError) {
          console.error("QR Generation Error:", qrError);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: "Failed to generate QR code"
            });
          }
        }
        return;
      }

      if (connection === "open") {
        try {
          await delay(5000);
          const auth_path = `${sessionFolder}/creds.json`;
          const user_jid = jidNormalizedUser(RobinQR.user.id);

          if (fs.existsSync(auth_path)) {
            const session_json = JSON.parse(fs.readFileSync(auth_path, "utf8"));
            await Session.findOneAndUpdate(
              { number: user_jid },
              { number: user_jid, creds: session_json },
              { upsert: true }
            );
            console.log(`✅ QR Session stored for ${user_jid}`);
          }

          const success_msg = `╔════════════════════╗\n   ZEUS X NOW ONLINE (QR)\n╚════════════════════╝\n\n*🚀 Status:* Successfully Linked ✅\n*👤 User:* ${user_jid.split('@')[0]}\n*🗄️ Database:* MongoDB Secured 🔒\n\n> ඔබේ දත්ත අපගේ Database එකේ ආරක්ෂිතව තැන්පත් කරනවා.\n\n*📢 Join our official channel:*\nhttps://whatsapp.com/channel/0029VbCe8YW84OmKiJkDfk3o\n\n𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐙𝐄𝐔𝐒 𝐈𝐍𝐂`;
          
          await RobinQR.sendMessage(user_jid, { text: success_msg });

        } catch (e) {
          console.error("❌ Database or Messaging Error:", e);
        } finally {
          await delay(2000);
          if(RobinQR) RobinQR.logout();
          removeFile(sessionFolder);
          console.log(`♻️ Cleanup Done: ${sessionFolder}`);
        }
      } else if (
        connection === "close" &&
        lastDisconnect &&
        lastDisconnect.error &&
        lastDisconnect.error.output.statusCode !== 401
      ) {
        console.log("Connection closed unexpectedly");
      }
    });

    timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: "QR Code generation timeout. Please try again."
        });
        RobinQR.logout();
        removeFile(sessionFolder);
      }
    }, 60000);

  } catch (err) {
    console.error("QR Service Error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
    removeFile(sessionFolder);
  }
});

module.exports = router;
