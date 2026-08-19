try {
    console.log('Loading utils...');
    const utils = require('./utils');
    console.log('Loading commands...');
    const commands = require('./commands');
    console.log('Loading plugins...');
    require('./src/plugins/admin');
    require('./src/plugins/ai');
    require('./src/plugins/chess');
    require('./src/plugins/economy');
    require('./src/plugins/media');
    require('./src/plugins/media_api');
    require('./src/plugins/music');
    require('./src/plugins/princetech_api');
    require('./src/plugins/titan_ai');
    require('./src/plugins/tools');
    console.log('Requirements & Plugins OK.');
    process.exit(0);
} catch (e) {
    console.error('CRASH DETECTED:');
    console.error(e);
    process.exit(1);
}
