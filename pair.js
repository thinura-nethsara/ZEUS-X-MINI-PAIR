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

const MY_APP_ID = String(process.env.APP_ID || "1");

const SessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    creds: { type: Object, default: null },
    APP_ID: { type: String, required: true, default: MY_APP_ID },
}, { collection: "sessions" });

const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  
  if (!num) {
    return res.status(400).json({ success: false, error: "Phone number is required" });
  }

  num = num.replace(/[^0-9]/g, "");
  if (!num.startsWith("94") && num.length === 10) {
    num = "94" + num;
  }

  const sessionPath = `./session_${Date.now()}`;

  try {
    console.log(`📱 Starting pair for: ${num}`);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    // ✅ Modified Baileys configuration
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
      browser: ["ZANTA-MD", "Chrome", "120.0.0.0"],
      // ✅ Important: These options help with connection
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      emitOwnEvents: true,
      fireInitQueries: true,
      generateHighQualityLinkPreview: false,
      patchMessageBeforeSending: true,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // ✅ Better connection handling with retry
    let connectionEstablished = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!connectionEstablished && attempts < maxAttempts) {
      attempts++;
      console.log(`🔄 Connection attempt ${attempts}/${maxAttempts}`);
      
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Connection timeout"));
          }, 45000);

          sock.ev.once("connection.update", (update) => {
            const { connection, lastDisconnect } = update;
            console.log(`📡 Connection status: ${connection}`);
            
            if (connection === "open") {
              clearTimeout(timeout);
              connectionEstablished = true;
              resolve();
            } else if (connection === "close") {
              clearTimeout(timeout);
              const error = lastDisconnect?.error;
              if (error?.output?.statusCode === 401) {
                reject(new Error("Unauthorized"));
              } else {
                reject(new Error("Connection closed"));
              }
            }
          });
        });
      } catch (err) {
        console.log(`⚠️ Attempt ${attempts} failed: ${err.message}`);
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to connect after ${maxAttempts} attempts`);
        }
        await delay(2000);
        // Recreate socket for new attempt
        if (sock) {
          sock.ev.removeAllListeners();
        }
      }
    }

    if (!connectionEstablished) {
      throw new Error("Could not establish connection");
    }

    console.log("✅ Connection established successfully");

    // ✅ Request pairing code with proper handling
    try {
      const code = await sock.requestPairingCode(num);
      console.log(`✅ Pairing code: ${code}`);

      // Send response immediately
      await res.json({ 
        success: true, 
        code: code,
        number: num 
      });

      // ✅ Handle credentials
      sock.ev.on("creds.update", saveCreds);

      // ✅ Wait for successful login
      await new Promise((resolve) => {
        const loginTimeout = setTimeout(() => {
          console.log("⏰ Login timeout, continuing...");
          resolve();
        }, 90000);

        sock.ev.on("connection.update", async (update) => {
          const { connection } = update;
          if (connection === "open" && sock.authState.creds.registered) {
            clearTimeout(loginTimeout);
            try {
              const userJid = jidNormalizedUser(sock.user.id);
              console.log(`✅ User connected: ${userJid}`);
              
              const authPath = `${sessionPath}/creds.json`;
              if (fs.existsSync(authPath)) {
                const sessionData = JSON.parse(fs.readFileSync(authPath, "utf8"));
                
                await Session.findOneAndUpdate(
                  { number: userJid },
                  {
                    number: userJid,
                    creds: sessionData,
                    APP_ID: MY_APP_ID
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

    } catch (pairError) {
      console.error("❌ Pairing error:", pairError.message);
      if (!res.headersSent) {
        await res.status(500).json({ 
          success: false, 
          error: "Failed to get pairing code. Please try again." 
        });
      }
    }

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
        error: error.message || "Pairing failed. Please try again." 
      });
    }
    
    removeFile(sessionPath);
  }
});

module.exports = router;
