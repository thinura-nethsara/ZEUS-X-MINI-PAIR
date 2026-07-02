import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB Connection
const MONGODB_URL = "mongodb+srv://Angle:99999978666@cluster0.ynt3dwp.mongodb.net/";

mongoose.connect(MONGODB_URL)
    .then(() => console.log('✅ MongoDB Connected Successfully'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Existing pair router
import codeRouter from './pair.js';
app.use('/code', codeRouter);

// QR router
import qrRouter from './qr.js';
app.use('/qr', qrRouter);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 ZEUS X Web Server started on port ${PORT}`);
});
