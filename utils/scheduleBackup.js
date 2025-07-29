// utils/scheduleBackup.js
const cron = require('node-cron');
const BackupService = require('./backupService');

async function scheduleDailyBackup() {
  const backupService = new BackupService();

  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('Starting daily backup...');
      const backup = await backupService.createBackup();
      const { url, filename } = await backupService.saveBackupToBlob(backup);
      console.log(`Daily backup created: ${filename} at ${url}`);
    } catch (error) {
      console.error('Daily backup failed:', error);
    } finally {
      await backupService.disconnect();
    }
  }, {
    timezone: 'Asia/Karachi',
  });
}

module.exports = { scheduleDailyBackup };