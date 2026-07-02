const express = require('express');
const path = require('path');
const bodyParser = require("body-parser");
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 5000;

// ✅ MongoDB Connection
const MONGODB_URL = "mongodb+srv://Angle:99999978666@cluster0.ynt3dwp.mongodb.net/";

// MongoDB Connection
mongoose.connect(MONGODB_URL)
    .then(() => console.log('✅ MongoDB Connected Successfully'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Existing pair router
let codeRouter = require('./pair'); 
app.use('/code', codeRouter);

// ✅ New QR router
let qrRouter = require('./qr');
app.use('/qr', qrRouter);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 ZEUS X Web Server started on port ${PORT}`);
});
