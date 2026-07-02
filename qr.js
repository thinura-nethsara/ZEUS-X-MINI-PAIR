import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import QRCode from 'qrcode';
import {
    makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore,
    Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay, DisconnectReason
} from '@whiskeysockets/baileys';
import mongoose from 'mongoose';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 60000;

// MongoDB Session Schema
const SessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    creds: { type: Object, required: true },
    added_at: { type: Date, default: Date.now }
});
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

const SUCCESS_MESSAGE = `╔════════════════════╗
   ZEUS X NOW ONLINE (QR)
╚════════════════════╝

*🚀 Status:* Successfully Linked ✅
*🗄️ Database:* MongoDB Secured 🔒
*📱 Method:* QR Code

> ඔබේ දත්ත අපගේ Database එකේ ආරක්ෂිතව තැන්පත් කරනවා.

*📢 Join our official channel:*
https://whatsapp.com/channel/0029VbCe8YW84OmKiJkDfk3o

𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐙𝐄𝐔𝐒 𝐈𝐍𝐂`;

async function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        await fs.remove(FilePath);
        return true;
    } catch (e) {
        console.error("Error removing file:", e);
        return false;
    }
}

router.get("/", async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = "./qr_sessions/session_" + sessionId;
    
    if (!fs.existsSync("./qr_sessions")) await fs.mkdir("./qr_sessions", { recursive: true });

    let qrGenerated = false;
    let sessionCompleted = false;
    let responseSent = false;
    let reconnectAttempts = 0;
    let currentSocket = null;
    let timeoutHandle = null;
    let isCleaningUp = false;

    async function cleanup(reason = "unknown") {
        if (isCleaningUp) return;
        isCleaningUp = true;

        console.log("🧹 Cleaning up session " + sessionId + " - Reason: " + reason);

        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }

        if (currentSocket) {
            try {
                currentSocket.ev.removeAllListeners();
                await currentSocket.end();
            } catch (e) {
                console.error("Error closing socket:", e);
            }
            currentSocket = null;
        }

        setTimeout(async () => {
            await removeFile(dirs);
        }, 5000);
    }

    async function initiateSession() {
        if (sessionCompleted || isCleaningUp) {
            console.log("⚠️ Session already completed or cleaning up");
            return;
        }

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.log("❌ Max reconnection attempts reached");
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).json({ 
                    success: false,
                    error: "Connection failed after multiple attempts" 
                });
            }
            await cleanup("max_reconnects");
            return;
        }

        if (!fs.existsSync(dirs)) await fs.mkdir(dirs, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            if (currentSocket) {
                try {
                    currentSocket.ev.removeAllListeners();
                    await currentSocket.end();
                } catch (e) {}
            }

            currentSocket = makeWASocket({
                version,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS("Chrome"),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 3,
            });

            const sock = currentSocket;

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent || sessionCompleted || isCleaningUp) return;
                qrGenerated = true;

                try {
                    const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: "M" });
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.json({
                            success: true,
                            qr: qrDataURL,
                            message: "QR Code Generated! Scan with WhatsApp app.",
                            sessionId: sessionId,
                            instructions: [
                                "1. Open WhatsApp on your phone",
                                "2. Go to Settings > Linked Devices",
                                "3. Tap \"Link a Device\"",
                                "4. Scan the QR code above"
                            ]
                        });
                        console.log("📱 QR Code sent to client");
                    }
                } catch (err) {
                    console.error("Error generating QR code:", err);
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(500).json({ 
                            success: false,
                            error: "Failed to generate QR code" 
                        });
                    }
                    await cleanup("qr_error");
                }
            };

            sock.ev.on("connection.update", async (update) => {
                if (isCleaningUp) return;

                const { connection, lastDisconnect, qr, isNewLogin } = update;

                if (qr && !qrGenerated && !sessionCompleted) {
                    await handleQRCode(qr);
                }

                if (connection === "open") {
                    if (sessionCompleted) return;
                    sessionCompleted = true;

                    try {
                        const credsFile = dirs + "/creds.json";
                        if (fs.existsSync(credsFile)) {
                            console.log("📄 Reading creds.json...");
                            const session_json = JSON.parse(await fs.readFile(credsFile, "utf8"));
                            
                            // Save to MongoDB
                            const userJid = Object.keys(sock.authState.creds.me || {}).length > 0
                                ? jidNormalizedUser(sock.authState.creds.me.id)
                                : null;

                            if (userJid) {
                                await Session.findOneAndUpdate(
                                    { number: userJid },
                                    { number: userJid, creds: session_json },
                                    { upsert: true }
                                );
                                console.log(`✅ Session stored in MongoDB for ${userJid}`);

                                // Send success message
                                await sock.sendMessage(userJid, { text: SUCCESS_MESSAGE });
                                console.log("✅ Success message sent to user");
                            }
                        }
                    } catch (err) {
                        console.error("Error saving session:", err);
                    } finally {
                        await delay(2000);
                        await cleanup("session_complete");
                    }
                }

                if (isNewLogin) console.log("🔐 New login via QR code");

                if (connection === "close") {
                    if (sessionCompleted || isCleaningUp) {
                        console.log("✅ Session completed, not reconnecting");
                        await cleanup("already_complete");
                        return;
                    }

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = lastDisconnect?.error?.output?.payload?.error;

                    console.log("❌ Connection closed - Status: " + statusCode + ", Reason: " + reason);

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log("❌ Logged out or invalid session");
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(401).json({ 
                                success: false,
                                error: "Invalid QR scan or session expired",
                                requireNewQR: true
                            });
                        }
                        await cleanup("logged_out");
                    } else if (qrGenerated && !sessionCompleted) {
                        reconnectAttempts++;
                        console.log("🔁 Reconnection attempt " + reconnectAttempts + "/" + MAX_RECONNECT_ATTEMPTS);
                        await delay(2000);
                        await initiateSession();
                    } else {
                        await cleanup("connection_closed");
                    }
                }
            });

            sock.ev.on("creds.update", saveCreds);

            timeoutHandle = setTimeout(async () => {
                if (!sessionCompleted && !isCleaningUp) {
                    console.log("⏰ QR generation timeout");
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).json({ 
                            success: false,
                            error: "QR generation timeout",
                            timeout: true
                        });
                    }
                    await cleanup("timeout");
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error("❌ Error initializing session:", err);
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).json({ 
                    success: false,
                    error: "Service Unavailable: " + err.message 
                });
            }
            await cleanup("init_error");
        }
    }

    await initiateSession();
});

// Cleanup old sessions every 5 minutes
setInterval(async () => {
    try {
        if (!fs.existsSync("./qr_sessions")) return;
        const sessions = await fs.readdir("./qr_sessions");
        const now = Date.now();
        for (const session of sessions) {
            const sessionPath = "./qr_sessions/" + session;
            try {
                const stats = await fs.stat(sessionPath);
                if (now - stats.mtimeMs > 300000) {
                    console.log("🗑️ Removing old session: " + session);
                    await fs.remove(sessionPath);
                }
            } catch (e) {}
        }
    } catch (e) {
        console.error("Error in cleanup interval:", e);
    }
}, 60000);

// Error handling
process.on("uncaughtException", (err) => {
    const e = String(err);
    const ignore = [
        "conflict", "not-authorized", "Socket connection timeout",
        "rate-overlimit", "Connection Closed", "Timed Out",
        "Value not found", "Stream Errored", "Stream Errored (restart required)",
        "statusCode: 515", "statusCode: 503"
    ];
    if (!ignore.some(x => e.includes(x))) {
        console.log("Caught exception:", err);
    }
});

export default router;
