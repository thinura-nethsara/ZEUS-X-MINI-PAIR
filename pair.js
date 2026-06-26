const express = require("express");
const fs = require("fs");
const path = require("path");
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

// ✅ Session folder එක නිවැරදිව create කිරීම
function ensureSessionFolder() {
  const sessionPath = path.join(process.cwd(), "session");
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
    console.log("📁 Session folder created");
  }
  return sessionPath;
}

// සෙෂන් ෆෝල්ඩරය පිරිසිදු කිරීම
function cleanSessionFolder() {
  const sessionPath = path.join(process.cwd(), "session");
  if (fs.existsSync(sessionPath)) {
    try {
      // creds.json විතරක් මකන්න, folder එක නොමකන්න
      const credsPath = path.join(sessionPath, "creds.json");
      if (fs.existsSync(credsPath)) {
        fs.unlinkSync(credsPath);
        console.log("🧹 creds.json removed");
      }
      // අනිත් files මකන්න
      const files = fs.readdirSync(sessionPath);
      for (const file of files) {
        if (file !== 'creds.json') {
          const filePath = path.join(sessionPath, file);
          fs.unlinkSync(filePath);
        }
      }
    } catch (err) {
      console.log("⚠️ Could not clean session:", err.message);
    }
  }
}

// සෙෂන් එක MongoDB වලට සේව් කරන ෆන්ෂන් එක
async function saveSessionToMongo(userJid, credsData) {
  try {
    await Session.findOneAndUpdate(
      { number: userJid },
      {
        number: userJid,
        creds: credsData
      },
      { upsert: true }
    );
    console.log(`✅ Session saved to MongoDB for ${userJid}`);
    return true;
  } catch (error) {
    console.error("❌ MongoDB Save Error:", error.message);
    return false;
  }
}

// Pairing ක්‍රියාවලිය
async function startPairing(number, res) {
  let pairingSuccessful = false;
  let responseSent = false;
  let pairingCode = null;
  
  // ✅ Session folder එක exist වෙනවාට වග බලාගන්න
  ensureSessionFolder();
  
  // පැරණි creds.json මකන්න
  cleanSessionFolder();
  
  try {
    // ✅ useMultiFileAuthState එකට නිවැරදි path එක දෙන්න
    const sessionPath = path.join(process.cwd(), "session");
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
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
      // ✅ Connection settings
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // Pairing Code එක ලබා ගැනීම
    if (!RobinPairWeb.authState.creds.registered) {
      await delay(1500);
      const cleanNumber = number.replace(/[^0-9]/g, "");
      pairingCode = await RobinPairWeb.requestPairingCode(cleanNumber);
      
      // Response එක යවන්න
      if (!res.headersSent && !responseSent) {
        responseSent = true;
        await res.json({ 
          success: true, 
          code: pairingCode,
          message: "Pairing code sent successfully!"
        });
      }
    }

    // Connection Events
    RobinPairWeb.ev.on("creds.update", async (creds) => {
      console.log("🔄 Creds updated, saving...");
      await saveCreds();
    });
    
    RobinPairWeb.ev.on("connection.update", async (s) => {
      const { connection, lastDisconnect } = s;
      console.log(`📡 Connection update: ${connection}`);
      
      if (connection === "open") {
        try {
          await delay(3000);
          const credsPath = path.join(process.cwd(), "session", "creds.json");
          
          if (fs.existsSync(credsPath)) {
            const userJid = jidNormalizedUser(RobinPairWeb.user.id);
            const sessionData = JSON.parse(fs.readFileSync(credsPath, "utf8"));
            
            // MongoDB වලට සේව් කරන්න
            await saveSessionToMongo(userJid, sessionData);
            
            // සාර්ථක පණිවිඩය යවන්න
            const successMsg = `╔════════════════════╗
  ✨ *ZANTA-MD CONNECTED* ✨
╚════════════════════╝

*🚀 Status:* Successfully Linked ✅
*👤 User:* ${userJid.split('@')[0]}
*🗄️ Database:* MongoDB Secured 🔒

> ඔබේ දත්ත අපගේ Database එකේ ආරක්ෂිතව තැන්පත් කරන ලදී. දැන් බොට් ස්වයංක්‍රීයව ක්‍රියාත්මක වනු ඇත.

*📢 Join our official channel for updates:*
https://whatsapp.com/channel/0029VbBc42s84OmJ3V1RKd2B

*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴢᴀɴᴛᴀ ᴏꜰᴄ* 🧬`;

            try {
              await RobinPairWeb.sendMessage(userJid, { text: successMsg });
              console.log("✅ Success message sent to user");
            } catch (sendError) {
              console.log("⚠️ Could not send message:", sendError.message);
            }
            
            pairingSuccessful = true;
            
            // Session එක පිරිසිදු කරන්න
            await delay(2000);
            cleanSessionFolder();
            console.log("✅ Pairing completed successfully");
            
            // WebSocket එක වසන්න
            await RobinPairWeb.ws.close();
            await RobinPairWeb.end();
            
          } else {
            console.log("⚠️ creds.json file not found");
          }
        } catch (error) {
          console.error("❌ Error during connection open:", error.message);
        }
      }
      
      if (connection === "close") {
        if (lastDisconnect?.error?.output?.statusCode !== 401) {
          console.log("🔄 Connection closed, attempting to reconnect...");
          await delay(5000);
          if (!pairingSuccessful && !responseSent) {
            // නැවත උත්සාහ කරන්න
            startPairing(number, res).catch(console.error);
          }
        } else {
          console.log("❌ Unauthorized - session expired");
        }
      }
    });

    // Timeout - මිනිත්තු 3 කට පසු pairing එක අවසන් කරන්න
    setTimeout(() => {
      if (!pairingSuccessful) {
        console.log("⏰ Pairing timeout - cleaning up");
        if (!responseSent) {
          responseSent = true;
          res.status(408).json({ 
            success: false, 
            error: "Pairing timeout. Please try again." 
          });
        }
        cleanSessionFolder();
      }
    }, 180000);

  } catch (error) {
    console.error("❌ Pairing Error:", error.message);
    console.error("❌ Stack:", error.stack);
    if (!responseSent) {
      responseSent = true;
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
    cleanSessionFolder();
  }
}

// Main Route
router.get("/", async (req, res) => {
  const number = req.query.number;
  
  console.log(`📱 Received pairing request for: ${number}`);
  
  // Validate number
  if (!number) {
    return res.status(400).json({ 
      success: false, 
      error: "Phone number is required" 
    });
  }

  // Clean number
  const cleanNumber = number.replace(/[^0-9]/g, "");
  if (cleanNumber.length < 10) {
    return res.status(400).json({ 
      success: false, 
      error: "Invalid phone number. Must be at least 10 digits." 
    });
  }

  console.log(`📱 Starting pairing for: ${cleanNumber}`);
  
  try {
    await startPairing(cleanNumber, res);
  } catch (error) {
    console.error("❌ Route Error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        error: "Internal server error" 
      });
    }
  }
});

module.exports = router;
