const express = require("express");
const fs = require("fs");
const mongoose = require("mongoose");
let router = express.Router();
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

// MongoDB Session Schema
const SessionSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  creds: { type: Object, required: true },
  added_at: { type: Date, default: Date.now }
});
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  
  if (!num) {
    return res.status(400).json({ error: "Number is required" });
  }

  async function RobinPair() {
    const { state, saveCreds } = await useMultiFileAuthState(`./session`);
    
    try {
      // Get latest Baileys version
      const { version } = await fetchLatestBaileysVersion();
      console.log(`Using Baileys version: ${version}`);

      let RobinPairWeb = makeWASocket({
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
        version: version,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
      });

      // Handle connection events
      RobinPairWeb.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;
        
        if (connection === "open") {
          try {
            await delay(5000);
            const auth_path = "./session/creds.json";
            
            if (fs.existsSync(auth_path)) {
              const user_jid = jidNormalizedUser(RobinPairWeb.user.id);
              
              // Save to MongoDB
              const session_json = JSON.parse(fs.readFileSync(auth_path, "utf8"));
              await Session.findOneAndUpdate(
                { number: user_jid },
                {
                  number: user_jid,
                  creds: session_json
                },
                { upsert: true }
              );

              console.log(`✅ Session stored in MongoDB for ${user_jid}`);

              // Send success message
              const success_msg = `╔════════════════════╗
  ✨ *ZANTA-MD CONNECTED* ✨
╚════════════════════╝

*🚀 Status:* Successfully Linked ✅
*👤 User:* ${user_jid.split('@')[0]}
*🗄️ Database:* MongoDB Secured 🔒

> ඔබේ දත්ත අපගේ Database එකේ ආරක්ෂිතව තැන්පත් කරන ලදී.

*📢 Join our channel:*
https://whatsapp.com/channel/0029VbBc42s84OmJ3V1RKd2B

*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ* 🧬`;

              await RobinPairWeb.sendMessage(user_jid, { text: success_msg });
              
              await delay(2000);
              removeFile("./session");
              console.log("♻️ Cleanup Done");
              process.exit(0);
            }
          } catch (e) {
            console.error("❌ Error in connection.open:", e);
          }
        } else if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          if (statusCode !== 401) {
            console.log("Connection closed, reconnecting...");
            await delay(5000);
            RobinPair();
          }
        }
      });

      // Request pairing code
      await delay(2000);
      num = num.replace(/[^0-9]/g, "");
      
      try {
        const code = await RobinPairWeb.requestPairingCode(num);
        if (!res.headersSent) {
          await res.send({ code });
        }
        console.log(`✅ Pairing code sent to ${num}`);
      } catch (pairError) {
        console.error("Pairing error:", pairError);
        if (!res.headersSent) {
          await res.status(500).json({ 
            error: "Failed to get pairing code. Please try again.",
            details: pairError.message 
          });
        }
      }

      // Save creds on update
      RobinPairWeb.ev.on("creds.update", saveCreds);

    } catch (err) {
      console.error("Service Error:", err);
      if (!res.headersSent) {
        await res.status(500).json({ error: "Service error. Please try again." });
      }
      await delay(5000);
      RobinPair();
    }
  }

  return await RobinPair();
});

module.exports = router;
