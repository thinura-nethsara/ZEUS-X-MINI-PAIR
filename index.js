const express = require('express');
const path = require('path');
const bodyParser = require("body-parser");
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 8000;

// ✅ MongoDB Connection
const MONGODB_URL = "mongodb+srv://Angle:99999978666@cluster0.ynt3dwp.mongodb.net/";

mongoose.connect(MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Connected Successfully'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static files
app.use(express.static(__dirname));

// Routes
let codeRouter = require('./pair'); 
app.use('/code', codeRouter);

// Home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err.message);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 ZANTA-MD Web Server started on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down server...');
    server.close(() => {
        mongoose.connection.close(() => {
            console.log('✅ MongoDB connection closed');
            process.exit(0);
        });
    });
});
