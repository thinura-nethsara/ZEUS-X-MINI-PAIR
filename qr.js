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
  fetchLatestBaileysVersion,
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
  let connectionEstablished = false;

  try {
    console.log(`🔹 Starting QR session: ${uniqueSessionId}`);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    
    const RobinQR = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(
          state.keys,
          pino({ level: "silent" })
        ),
      },
      printQRInTerminal: true, // Terminal එකේත් print වෙන්න
      logger: pino({ level: "silent" }),
      browser: Browsers.macOS("Safari"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
    });

    // Creds update event
    RobinQR.ev.on("creds.update", saveCreds);

    // QR Code event - මෙය වැදගත්ම කොටස
    RobinQR.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect, isNewLogin } = update;

      console.log("📡 Update:", { connection, hasQR: !!qr, isNewLogin });

      // QR code එක ලැබුණු විට
      if (qr && !qrSent && !connectionEstablished) {
        qrSent = true;
        console.log("✅ QR Code generated successfully");
        
        try {
          // QR code එක base64 image එකක් විදියට convert කරනවා
          const qrImage = await qrcode.toDataURL(qr, {
            errorCorrectionLevel: 'H',
            margin: 2,
            scale: 8,
          });
          
          if (!res.headersSent) {
            res.status(200).json({
              success: true,
              qr: qrImage,
              message: "Scan this QR code with WhatsApp mobile app",
              sessionId: uniqueSessionId,
              timestamp: new Date().toISOString()
            });
          }
        } catch (qrError) {
          console.error("❌ QR Generation Error:", qrError);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: "Failed to generate QR code: " + qrError.message
            });
          }
        }
        return;
      }

      // Connection open වෙනවා - QR scan කළා
      if (connection === "open" && !connectionEstablished) {
        connectionEstablished = true;
        console.log("✅ WhatsApp connection established!");
        
        try {
          await delay(3000);
          const auth_path = `${sessionFolder}/creds.json`;
          const user_jid = jidNormalizedUser(RobinQR.user.id);

          // MongoDB එකට save කරනවා
          if (fs.existsSync(auth_path)) {
            const session_json = JSON.parse(fs.readFileSync(auth_path, "utf8"));
            await Session.findOneAndUpdate(
              { number: user_jid },
              { number: user_jid, creds: session_json },
              { upsert: true }
            );
            console.log(`✅ QR Session saved to MongoDB for ${user_jid}`);
          }

          // Success message එක send කරනවා
          const success_msg = `╔════════════════════╗\n   ZEUS X NOW ONLINE (QR)\n╚════════════════════╝\n\n*🚀 Status:* Successfully Linked ✅\n*👤 User:* ${user_jid.split('@')[0]}\n*🗄️ Database:* MongoDB Secured 🔒\n*📱 Method:* QR Code\n\n> ඔබේ දත්ත අපගේ Database එකේ ආරක්ෂිතව තැන්පත් කරනවා.\n\n*📢 Join our official channel:*\nhttps://whatsapp.com/channel/0029VbCe8YW84OmKiJkDfk3o\n\n𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐙𝐄𝐔𝐒 𝐈𝐍𝐂`;
          
          await RobinQR.sendMessage(user_jid, { text: success_msg });
          console.log("✅ Success message sent to user");

        } catch (e) {
          console.error("❌ Database or Messaging Error:", e);
        } finally {
          // Cleanup - session folder එක delete කරනවා
          await delay(2000);
          if(RobinQR) {
            try { await RobinQR.logout(); } catch(e) {}
          }
          removeFile(sessionFolder);
          console.log(`♻️ Cleanup Done: ${sessionFolder}`);
        }
      }

      // Connection close වෙනවා
      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log("❌ Connection closed with status:", statusCode);
        
        if (statusCode === 401) {
          console.log("🔐 Unauthorized - need new QR");
          // QR sent කරලා නැත්නම් error response එක
          if (!qrSent && !res.headersSent) {
            res.status(401).json({
              success: false,
              error: "Session expired. Please generate new QR.",
              requireNewQR: true
            });
          }
        }
        
        // Connection established නැතිව close වුණොත් cleanup
        if (!connectionEstablished) {
          removeFile(sessionFolder);
        }
      }
    });

    // Timeout - තත්පර 90
    timeoutId = setTimeout(() => {
      if (!res.headersSent && !connectionEstablished) {
        console.log("⏰ QR generation timeout");
        res.status(408).json({
          success: false,
          error: "QR Code generation timeout. Please try again.",
          timeout: true
        });
        try { RobinQR.logout(); } catch(e) {}
        removeFile(sessionFolder);
      }
    }, 90000);

  } catch (err) {
    console.error("❌ QR Service Error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Internal server error: " + err.message
      });
    }
    removeFile(sessionFolder);
  }
});

module.exports = router;
