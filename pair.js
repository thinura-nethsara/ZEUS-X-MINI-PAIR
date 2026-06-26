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

// සෙෂන් ෆෝල්ඩරය පිරිසිදු කිරීමේ ෆන්ෂන් එක
function cleanSessionFolder() {
  const sessionPath = "./session";
  if (fs.existsSync(sessionPath)) {
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log("🧹 Session folder cleaned");
    } catch (err) {
      console.log("⚠️ Could not clean session folder:", err.message);
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
  
  // නව session folder එකක් සාදන්න
  cleanSessionFolder();
  
  const { state, saveCreds } = await useMultiFileAuthState(`./session`);
  
  try {
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
    });

    // Pairing Code එක ලබා ගැනීම
    if (!RobinPairWeb.authState.creds.registered) {
      await delay(1500);
      const cleanNumber = number.replace(/[^0-9]/g, "");
      const code = await RobinPairWeb.requestPairingCode(cleanNumber);
      
      // Response එක යවන්න
      if (!res.headersSent && !responseSent) {
        responseSent = true;
        await res.json({ 
          success: true, 
          code: code,
          message: "Pairing code sent successfully!"
        });
      }
    }

    // Connection Events
    RobinPairWeb.ev.on("creds.update", saveCreds);
    
    RobinPairWeb.ev.on("connection.update", async (s) => {
      const { connection, lastDisconnect } = s;
      
      if (connection === "open") {
        try {
          await delay(3000);
          const authPath = "./session/creds.json";
          
          if (fs.existsSync(authPath)) {
            const userJid = jidNormalizedUser(RobinPairWeb.user.id);
            const sessionData = JSON.parse(fs.readFileSync(authPath, "utf8"));
            
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
            
            // Session එක පිරිසිදු කරන්න (නමුත් server එක නවත්වන්න එපා)
            await delay(2000);
            cleanSessionFolder();
            console.log("✅ Pairing completed successfully");
            
          } else {
            console.log("⚠️ creds.json file not found");
          }
        } catch (error) {
          console.error("❌ Error during connection open:", error.message);
        }
      }
      
      if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log("🔄 Connection closed, attempting to reconnect...");
        await delay(5000);
        if (!pairingSuccessful && !responseSent) {
          // නැවත උත්සාහ කරන්න
          startPairing(number, res).catch(console.error);
        }
      }
    });

    // Timeout - මිනිත්තු 2 කට පසු pairing එක අවසන් කරන්න
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
    }, 120000);

  } catch (error) {
    console.error("❌ Pairing Error:", error.message);
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
