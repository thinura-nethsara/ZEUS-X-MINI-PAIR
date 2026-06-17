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

  // Clean number
  num = num.replace(/[^0-9]/g, "");
  
  // Add country code if missing (Sri Lanka default)
  if (!num.startsWith("94") && num.length === 10) {
    num = "94" + num;
  }

  async function RobinPair() {
    // Create unique session folder per request
    const sessionId = Date.now().toString();
    const sessionPath = `./session_${sessionId}`;
    
    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      
      // Create socket with better configuration
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
        // ✅ Important: Keep connection alive
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        patchMessageBeforeSending: true,
      });

      // ✅ Wait for connection to be ready
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 30000);

        RobinPairWeb.ev.on("connection.update", async (update) => {
          const { connection, lastDisconnect } = update;
          
          if (connection === "open") {
            clearTimeout(timeout);
            resolve();
          } else if (connection === "close") {
            clearTimeout(timeout);
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== 401) {
              reject(new Error("Connection closed"));
            }
          }
        });
      });

      // ✅ Now request pairing code after connection is open
      if (!RobinPairWeb.authState.creds.registered) {
        await delay(1000);
        const code = await RobinPairWeb.requestPairingCode(num);
        
        // Send code to client
        if (!res.headersSent) {
          await res.json({ 
            success: true, 
            code: code,
            number: num 
          });
        }

        // Listen for successful pairing
        RobinPairWeb.ev.on("creds.update", saveCreds);
        
        RobinPairWeb.ev.on("connection.update", async (s) => {
          const { connection } = s;
          if (connection === "open") {
            try {
              await delay(5000);
              const auth_path = `${sessionPath}/creds.json`;
              
              if (fs.existsSync(auth_path)) {
                const user_jid = jidNormalizedUser(RobinPairWeb.user.id);
                const session_json = JSON.parse(fs.readFileSync(auth_path, "utf8"));
                
                // Save to MongoDB
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

> ඔබගේ WhatsApp Bot සාර්ථකව සම්බන්ධ විය!

*📢 Join our official channel:*
https://whatsapp.com/channel/0029VbBc42s84OmJ3V1RKd2B

*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ* 🧬`;

                await RobinPairWeb.sendMessage(user_jid, { text: success_msg });
              }
            } catch (e) {
              console.error("❌ Database or Messaging Error:", e);
            } finally {
              await delay(2000);
              removeFile(sessionPath);
              console.log("♻️ Cleanup Done");
              process.exit(0);
            }
          }
        });
      }
    } catch (err) {
      console.error("Service Error:", err);
      
      // Send error to client
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          error: err.message || "Pairing failed" 
        });
      }
      
      // Cleanup
      removeFile(sessionPath);
    }
  }
  
  return await RobinPair();
});

module.exports = router;
