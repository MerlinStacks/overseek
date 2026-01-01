const restrictToLocalhost = (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    // Allow localhost (IPv4 127.0.0.1 or IPv6 ::1) and Private Networks (10.x, 172.16-31.x, 192.168.x)
    // Docker internal network is usually 172.x. Remote LAN is 192.168.x.
    const isLocal = clientIp.includes('127.0.0.1') || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
    const isPrivate = /^(::ffff:)?(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(clientIp);

    if (isLocal || isPrivate) {
        next();
    } else {
        console.warn(`[Security] Blocked external access to admin route from: ${clientIp}`);
        res.status(403).json({ error: 'Access Denied: Localhost only' });
    }
};

module.exports = { restrictToLocalhost };
