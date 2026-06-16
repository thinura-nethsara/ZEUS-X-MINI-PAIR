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

  let isCodeSent = false;
  let isProcessing = false;

  async function RobinPair() {
    if (isProcessing) return;
    isProcessing = true;

    const { state, saveCreds } = await useMultiFileAuthState(`./session`);
    
    try {
      const { version } = await fetchLatestBaileysVersion();
      console.log(`Using Baileys version: ${version}`);

      const sock = makeWASocket({
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
      sock.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;
        
        if (connection === "open") {
          console.log("✅ Connection opened!");
          
          try {
            await delay(2000);
            const user_jid = jidNormalizedUser(sock.user.id);
            console.log(`📱 User JID: ${user_jid}`);
            
            // Check if creds file exists
            const auth_path = "./session/creds.json";
            if (fs.existsSync(auth_path)) {
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

              try {
                await sock.sendMessage(user_jid, { text: success_msg });
                console.log("✅ Success message sent!");
              } catch (sendErr) {
                console.error("❌ Send message error:", sendErr.message);
                // Try alternative method
                try {
                  await sock.sendMessage(user_jid, { text: "✅ ZANTA-MD Successfully Connected! 🎉" });
                  console.log("✅ Simple message sent!");
                } catch (err2) {
                  console.error("❌ Both message attempts failed");
                }
              }
              
              await delay(3000);
              removeFile("./session");
              console.log("♻️ Cleanup Done");
              
              setTimeout(() => {
                process.exit(0);
              }, 2000);
            }
          } catch (error) {
            console.error("❌ Error in connection.open:", error.message);
          }
        } else if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          if (statusCode !== 401 && !isCodeSent) {
            console.log(`Connection closed, retrying...`);
            isProcessing = false;
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
        const code = await sock.requestPairingCode(num);
        isCodeSent = true;
        if (!res.headersSent) {
          await res.send({ code });
        }
        console.log(`✅ Pairing code sent to ${num}`);
        
        // Save creds on update
        sock.ev.on("creds.update", saveCreds);
        
        // Keep connection alive
        setTimeout(() => {
          if (!isCodeSent) {
            console.log("⏰ Pairing timeout, retrying...");
            isProcessing = false;
            RobinPair();
          }
        }, 30000);
        
      } catch (pairError) {
        console.error("❌ Pairing error:", pairError.message);
        isProcessing = false;
        if (!res.headersSent) {
          await res.status(500).json({ 
            error: "Failed to get pairing code",
            details: pairError.message 
          });
        }
        await delay(5000);
        RobinPair();
      }

    } catch (err) {
      console.error("❌ Service Error:", err.message);
      isProcessing = false;
      if (!res.headersSent) {
        await res.status(500).json({ error: "Service error. Please try again." });
      }
    }
  }

  return await RobinPair();
});

module.exports = router;
