try {
    console.log('Loading utils...');
    const utils = require('./utils');
    console.log('Loading commands...');
    const commands = require('./commands');
    console.log('Loading index...');
    // const index = require('./index'); // This would start the bot
    console.log('Requirements OK.');
} catch (e) {
    console.error('CRASH DETECTED:');
    console.error(e);
    process.exit(1);
}
