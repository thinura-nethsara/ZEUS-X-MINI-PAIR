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

  let pairSuccessful = false;
  let pairAttempts = 0;
  const maxAttempts = 3;

  async function RobinPair() {
    if (pairAttempts >= maxAttempts) {
      console.log("❌ Max pairing attempts reached");
      if (!res.headersSent) {
        await res.status(500).json({ error: "Failed to pair after multiple attempts" });
      }
      return;
    }

    pairAttempts++;
    console.log(`🔄 Pairing attempt ${pairAttempts}/${maxAttempts}`);
    
    const { state, saveCreds } = await useMultiFileAuthState(`./session`);
    
    try {
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
        connectTimeoutMs: 30000,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 15000,
        syncFullHistory: false,
        patchWhatsappMd: true,
      });

      // Handle connection events
      RobinPairWeb.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;
        
        if (connection === "open" && !pairSuccessful) {
          pairSuccessful = true;
          console.log("✅ Connection opened successfully!");
          
          try {
            await delay(3000);
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

*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ* 🧬`;

              await RobinPairWeb.sendMessage(user_jid, { text: success_msg });
              console.log("✅ Success message sent!");
              
              await delay(3000);
              removeFile("./session");
              console.log("♻️ Cleanup Done");
              
              // Successfully exit
              setTimeout(() => {
                process.exit(0);
              }, 2000);
            }
          } catch (e) {
            console.error("❌ Error sending message:", e);
          }
        } else if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          if (statusCode !== 401 && !pairSuccessful) {
            console.log(`Connection closed (${statusCode}), reconnecting...`);
            await delay(5000);
            RobinPair();
          } else if (statusCode === 401) {
            console.log("❌ Unauthorized - Invalid session");
            removeFile("./session");
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
        
        // Save creds on update
        RobinPairWeb.ev.on("creds.update", saveCreds);
        
      } catch (pairError) {
        console.error("❌ Pairing error:", pairError.message);
        if (!res.headersSent) {
          await res.status(500).json({ 
            error: "Failed to get pairing code",
            details: pairError.message 
          });
        }
      }

    } catch (err) {
      console.error("❌ Service Error:", err.message);
      if (!res.headersSent && pairAttempts >= maxAttempts) {
        await res.status(500).json({ error: "Service error. Please try again." });
      }
    }
  }

  return await RobinPair();
});

module.exports = router;
