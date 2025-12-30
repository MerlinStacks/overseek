require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

require('./logger'); // Override console
const { initDB } = require('./db');
const { initSocket } = require('./socket');

const adminRoutes = require('./routes/admin');
const syncRoutes = require('./routes/sync');
const dbRoutes = require('./routes/db');
const proxyRoutes = require('./routes/proxy');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(compression());
app.use(morgan('tiny'));
app.use(cors());
app.use(express.json());

// Init DB
initDB();

// Routes
app.use('/admin', adminRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/db', dbRoutes);
app.use('/api/proxy', proxyRoutes);

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
