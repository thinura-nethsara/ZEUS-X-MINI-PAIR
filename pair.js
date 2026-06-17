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
    
    // ✅ Create socket
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

    // ✅ Connection handling with sock.ev.on() (not once)
    let connectionEstablished = false;
    let connectionError = null;

    // Listen for connection updates
    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;
      console.log(`📡 Connection status: ${connection}`);
      
      if (connection === "open") {
        connectionEstablished = true;
        console.log("✅ Connection established successfully");
      } else if (connection === "close") {
        const error = lastDisconnect?.error;
        connectionError = error || new Error("Connection closed");
        console.log(`❌ Connection closed: ${connectionError.message}`);
      }
    });

    // ✅ Wait for connection with timeout
    let waitTime = 0;
    const maxWaitTime = 45000;
    
    while (!connectionEstablished && waitTime < maxWaitTime) {
      await delay(1000);
      waitTime += 1000;
      if (waitTime % 5000 === 0) {
        console.log(`⏳ Waiting for connection... ${waitTime/1000}s`);
      }
    }

    if (!connectionEstablished) {
      throw new Error("Connection timeout after 45 seconds");
    }

    if (connectionError) {
      throw connectionError;
    }

    console.log("✅ Connection ready, requesting pairing code...");

    // ✅ Request pairing code
    const code = await sock.requestPairingCode(num);
    console.log(`✅ Pairing code: ${code}`);

    // Send response
    await res.json({ 
      success: true, 
      code: code,
      number: num 
    });

    // ✅ Handle credentials
    sock.ev.on("creds.update", saveCreds);

    // ✅ Wait for successful login
    let loginCompleted = false;
    let loginTimeout = setTimeout(() => {
      console.log("⏰ Login timeout, continuing...");
      loginCompleted = true;
    }, 90000);

    sock.ev.on("connection.update", async (update) => {
      const { connection } = update;
      if (connection === "open" && sock.authState.creds.registered && !loginCompleted) {
        loginCompleted = true;
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
          console.error("❌ Error saving session:", e.message);
        }
      }
    });

    // Wait for login to complete or timeout
    while (!loginCompleted) {
      await delay(1000);
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
