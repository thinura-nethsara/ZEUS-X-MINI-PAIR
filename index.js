const express = require('express');
const path = require('path');
const bodyParser = require("body-parser");
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 8000;

// ✅ MongoDB Connection - ඔබගේ URL එක සෘජුවම
const MONGODB_URL = "mongodb+srv://Angle:99999978666@cluster0.ynt3dwp.mongodb.net/";

// MongoDB Connection
mongoose.connect(MONGODB_URL)
    .then(() => console.log('✅ MongoDB Connected Successfully'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let codeRouter = require('./pair'); 
app.use('/code', codeRouter);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 ZANTA-MD Web Server started on port ${PORT}`);
});
