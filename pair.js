const express = require("express");
const fs = require("fs");
const mongoose = require("mongoose");
let router = express.Router();
const pino = require("pino");
const { v4: uuidv4 } = require("uuid"); // ✅ එක් එක් යූසර්ට වෙනම ID එකක් හදන්න (npm install uuid කරගන්න)
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

// ✅ හරියටම අදාළ folder එක විතරක් මකන function එක
function removeFile(FilePath) {
  if (fs.existsSync(FilePath)) {
    fs.rmSync(FilePath, { recursive: true, force: true });
  }
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).send({ error: "Number is required" });

  // ✅ හැම රික්වෙස්ට් එකකටම රන්ඩම් ID එකක් හදනවා (උදා: ./session-abc123xyz)
  const uniqueSessionId = `session-${uuidv4()}`;
  const sessionFolder = `./${uniqueSessionId}`;

  async function RobinPair() {
    // ✅ දැන් හැමෝටම තනි තනි ෆෝල්ඩර් එකක් ලැබෙනවා
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    let RobinPairWeb = null;

    try {
      RobinPairWeb = makeWASocket({
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

      if (!RobinPairWeb.authState.creds.registered) {
        await delay(1500);
        num = num.replace(/[^0-9]/g, "");
        const code = await RobinPairWeb.requestPairingCode(num);
        if (!res.headersSent) {
          await res.send({ code });
        }
      }

      RobinPairWeb.ev.on("creds.update", saveCreds);
      
      RobinPairWeb.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;
        
        if (connection === "open") {
          try {
            await delay(5000);
            const auth_path = `${sessionFolder}/creds.json`;
            const user_jid = jidNormalizedUser(RobinPairWeb.user.id);

            // 1. MongoDB එකට සේව් කිරීම
            if (fs.existsSync(auth_path)) {
              const session_json = JSON.parse(fs.readFileSync(auth_path, "utf8"));
              await Session.findOneAndUpdate(
                { number: user_jid },
                { number: user_jid, creds: session_json },
                { upsert: true }
              );
              console.log(`✅ Session securely stored in MongoDB for ${user_jid}`);
            }

            // 2. මැසේජ් එක යැවීම
            const success_msg = `╔════════════════════╗\n   ZEUS X NOW ONLINE\n╚════════════════════╝\n\n*🚀 Status:* Successfully Linked ✅\n*👤 User:* ${user_jid.split('@')[0]}\n*🗄️ Database:* MongoDB Secured 🔒\n\n> ඔබේ දත්ත අපගේ Database එකේ ආරක්ෂිතව තැන්පත් කරන ลදී. දැන් බොට් ස්වයංක්‍රීයව ක්‍රියාත්මක වනු ඇත.\n\n*📢 Join our official channel for updates:*\nhttps://whatsapp.com/channel/0029VbCe8YW84OmKiJkDfk3o\n\n𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐙𝐄𝐔𝐒 𝐈𝐍𝐂 </>\n_Generated via ZEUS-X-PAIR_`;
            
            await RobinPairWeb.sendMessage(user_jid, { text: success_msg });

          } catch (e) {
            console.error("❌ Database or Messaging Error:", e);
          } finally {
            // 3. Cleanup - අදාළ යූසර්ගේ ෆෝල්ඩර් එක විතරක් මකනවා
            await delay(2000);
            if(RobinPairWeb) RobinPairWeb.logout(); // connection එක වහනවා
            removeFile(sessionFolder);
            console.log(`♻️ Cleanup Done: Local folder ${sessionFolder} cleared.`);
          }

        } else if (
          connection === "close" &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output.statusCode !== 401
        ) {
          await delay(10000);
          RobinPair();
        }
      });
    } catch (err) {
      console.log("Service Error:", err);
      removeFile(sessionFolder); // Error එකක් ආවොත් folder එක අයින් කරනවා
    }
  }
  
  await RobinPair();
});

module.exports = router;
