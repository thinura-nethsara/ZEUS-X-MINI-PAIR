import express from "express";
import fs from "fs";
import mongoose from "mongoose";
import pino from "pino";
import { v4 as uuidv4 } from "uuid";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";

const router = express.Router();

// MongoDB Session Schema
const SessionSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  creds: { type: Object, required: true },
  added_at: { type: Date, default: Date.now }
});
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

function removeFile(FilePath) {
  if (fs.existsSync(FilePath)) {
    fs.rmSync(FilePath, { recursive: true, force: true });
  }
}

router.get("/", async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).send({ error: "Number is required" });

  const uniqueSessionId = `session-${uuidv4()}`;
  const sessionFolder = `./${uniqueSessionId}`;

  async function RobinPair() {
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

            if (fs.existsSync(auth_path)) {
              const session_json = JSON.parse(fs.readFileSync(auth_path, "utf8"));
              await Session.findOneAndUpdate(
                { number: user_jid },
                { number: user_jid, creds: session_json },
                { upsert: true }
              );
              console.log(`✅ Session securely stored in MongoDB for ${user_jid}`);
            }

            const success_msg = `╔════════════════════╗\n   ZEUS X NOW ONLINE\n╚════════════════════╝\n\n*🚀 Status:* Successfully Linked ✅\n*👤 User:* ${user_jid.split('@')[0]}\n*🗄️ Database:* MongoDB Secured 🔒\n\n> ඔබේ දත්ත අපගේ Database එකේ ආරක්ෂිතව තැන්පත් කරනවා. දැන් බොට් ස්වයංක්‍රීයව ක්‍රියාත්මක වනු ඇත.\n\n*📢 Join our official channel for updates:*\nhttps://whatsapp.com/channel/0029VbCe8YW84OmKiJkDfk3o\n\n𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐙𝐄𝐔𝐒 𝐈𝐍𝐂 </>\n_Generated via ZEUS-X-PAIR_`;
            
            await RobinPairWeb.sendMessage(user_jid, { text: success_msg });

          } catch (e) {
            console.error("❌ Database or Messaging Error:", e);
          } finally {
            await delay(2000);
            if(RobinPairWeb) RobinPairWeb.logout();
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
      removeFile(sessionFolder);
    }
  }
  
  await RobinPair();
});

export default router;
