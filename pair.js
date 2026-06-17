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

// ✅ APP_ID එක define කරන්න
const MY_APP_ID = String(process.env.APP_ID || "1");

// ✅ MongoDB Session Schema - APP_ID එක්ක
const SessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    creds: { type: Object, default: null },
    APP_ID: { type: String, required: true, default: MY_APP_ID }, // ✅ මෙය එකතු කරන්න
}, { collection: "sessions" });

const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  
  if (!num) {
    return res.status(400).json({ 
      success: false, 
      error: "Phone number is required" 
    });
  }

  num = num.replace(/[^0-9]/g, "");
  if (!num.startsWith("94") && num.length === 10) {
    num = "94" + num;
  }

  const sessionPath = `./session_${Date.now()}`;

  async function RobinPair() {
    try {
      console.log(`📱 Starting pair for: ${num}`);
      
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      
      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: "silent" })
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Safari"),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
      });

      // Wait for connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 30000);

        sock.ev.on("connection.update", (update) => {
          const { connection, lastDisconnect } = update;
          
          if (connection === "open") {
            clearTimeout(timeout);
            resolve();
          } else if (connection === "close") {
            clearTimeout(timeout);
            const error = lastDisconnect?.error;
            reject(error || new Error("Connection closed"));
          }
        });
      });

      // Get pairing code
      const code = await sock.requestPairingCode(num);
      console.log(`✅ Pairing code: ${code}`);

      // Send response
      if (!res.headersSent) {
        await res.json({ 
          success: true, 
          code: code,
          number: num 
        });
      }

      // Handle credentials update
      sock.ev.on("creds.update", saveCreds);

      // Wait for successful login
      await new Promise((resolve) => {
        sock.ev.on("connection.update", async (update) => {
          const { connection } = update;
          if (connection === "open" && sock.authState.creds.registered) {
            try {
              const userJid = jidNormalizedUser(sock.user.id);
              console.log(`✅ User connected: ${userJid}`);
              
              const authPath = `${sessionPath}/creds.json`;
              if (fs.existsSync(authPath)) {
                const sessionData = JSON.parse(fs.readFileSync(authPath, "utf8"));
                
                // ✅ APP_ID එකත් එක්ක save කරන්න
                await Session.findOneAndUpdate(
                  { number: userJid },
                  {
                    number: userJid,
                    creds: sessionData,
                    APP_ID: MY_APP_ID  // ✅ මෙය එකතු කරන්න
                  },
                  { upsert: true }
                );
                
                console.log(`✅ Session saved to MongoDB with APP_ID: ${MY_APP_ID}`);
                
                const msg = `╔════════════════════╗
  ✨ *ZANTA-MD CONNECTED* ✨
╚════════════════════╝

*🚀 Status:* Successfully Linked ✅
*👤 User:* ${userJid.split('@')[0]}
*🗄️ Database:* MongoDB Secured 🔒

> ඔබගේ WhatsApp Bot සාර්ථකව සම්බන්ධ විය!

*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ* 🧬`;

                await sock.sendMessage(userJid, { text: msg });
              }
            } catch (e) {
              console.error("❌ Error:", e.message);
            }
            resolve();
          }
        });
      });

      // Cleanup
      setTimeout(() => {
        sock?.ev?.removeAllListeners();
        removeFile(sessionPath);
        console.log("♻️ Cleanup done");
      }, 5000);

    } catch (error) {
      console.error("❌ Service Error:", error.message);
      
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          error: error.message || "Pairing failed" 
        });
      }
      
      removeFile(sessionPath);
    }
  }

  return await RobinPair();
});

module.exports = router;
