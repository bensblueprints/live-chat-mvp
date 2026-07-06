const { createServer } = require('./app');

const PORT = Number(process.env.PORT) || 5314;
const server = createServer();

server.listen(PORT, () => {
  console.log('Chatlet running');
  console.log(`  Dashboard : http://localhost:${PORT}/admin/`);
  console.log(`  Widget    : <script src="http://localhost:${PORT}/chat.js" data-site="YOUR_SITE_ID"></script>`);
});
