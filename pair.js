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
  proto,
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

// Clean session folder before start
if (fs.existsSync("./session")) {
  removeFile("./session");
  console.log("🧹 Cleaned old session");
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  
  if (!num) {
    return res.status(400).json({ error: "Number is required" });
  }

  // Format number correctly
  num = num.replace(/[^0-9]/g, "");
  if (!num.startsWith("94")) {
    num = "94" + num;
  }
  console.log(`📱 Formatted number: ${num}`);

  let pairingCode = null;
  let isLinked = false;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(`./session`);
    const { version } = await fetchLatestBaileysVersion();
    
    console.log(`📡 Baileys version: ${version.join('.')}`);

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
      version: version,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      syncFullHistory: false,
      patchWhatsappMd: true,
      markOnlineOnConnect: true,
    });

    // Handle connection updates
    sock.ev.on("connection.update", async (s) => {
      const { connection, lastDisconnect } = s;
      
      if (connection === "open") {
        console.log("✅ Connection opened successfully!");
        isLinked = true;
        
        try {
          await delay(3000);
          const user_jid = jidNormalizedUser(sock.user.id);
          console.log(`👤 User JID: ${user_jid}`);
          
          // Save session to MongoDB
          const auth_path = "./session/creds.json";
          if (fs.existsSync(auth_path)) {
            const session_json = JSON.parse(fs.readFileSync(auth_path, "utf8"));
            await Session.findOneAndUpdate(
              { number: user_jid },
              {
                number: user_jid,
                creds: session_json
              },
              { upsert: true }
            );
            console.log(`✅ Session saved to MongoDB for ${user_jid}`);
            
            // Send welcome message
            const welcomeMsg = `╔════════════════════╗
  ✨ *ZANTA-MD CONNECTED* ✨
╚════════════════════╝

*🚀 Status:* Successfully Linked ✅
*👤 User:* ${user_jid.split('@')[0]}
*🗄️ Database:* MongoDB Secured 🔒

> ඔබේ දත්ත අපගේ Database එකේ ආරක්ෂිතව තැන්පත් කරන ලදී.

*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ* 🧬`;

            try {
              await sock.sendMessage(user_jid, { text: welcomeMsg });
              console.log("✅ Welcome message sent!");
            } catch (err) {
              console.log("⚠️ Could not send welcome message:", err.message);
            }
            
            await delay(2000);
            removeFile("./session");
            console.log("🧹 Session cleaned up");
            
            setTimeout(() => {
              process.exit(0);
            }, 3000);
          }
        } catch (err) {
          console.error("❌ Error in connection.open:", err.message);
        }
      } else if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`🔴 Connection closed with code: ${statusCode}`);
        
        if (statusCode === 401) {
          console.log("❌ Unauthorized - Deleting session");
          removeFile("./session");
        } else if (!isLinked) {
          console.log("🔄 Retrying connection...");
          await delay(5000);
          // Don't retry automatically, let user try again
        }
      }
    });

    // Request pairing code
    console.log(`📱 Requesting pairing code for ${num}...`);
    
    try {
      pairingCode = await sock.requestPairingCode(num);
      console.log(`✅ Pairing code generated: ${pairingCode}`);
      
      // Send code to client
      if (!res.headersSent) {
        await res.send({ 
          code: pairingCode,
          number: num,
          message: "Enter this code in WhatsApp > Linked Devices > Link a Device > Enter Code"
        });
      }
      
      // Save creds on update
      sock.ev.on("creds.update", saveCreds);
      
      // Wait for pairing to complete
      await delay(60000); // Wait 60 seconds for pairing
      
      if (!isLinked) {
        console.log("⚠️ Pairing timeout - device not linked");
        removeFile("./session");
      }
      
    } catch (pairError) {
      console.error("❌ Pairing error:", pairError.message);
      
      if (!res.headersSent) {
        await res.status(500).json({ 
          error: "Failed to get pairing code",
          message: pairError.message,
          suggestion: "Make sure the number is correct and try again"
        });
      }
      
      removeFile("./session");
    }

  } catch (err) {
    console.error("❌ Service Error:", err.message);
    if (!res.headersSent) {
      await res.status(500).json({ 
        error: "Service error",
        message: err.message 
      });
    }
  }
});

module.exports = router;
