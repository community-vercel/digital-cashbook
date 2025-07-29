// utils/sendEmail.js
const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const Setting = require('../models/Setting');

async function sendDailyReportEmail(blobUrl, date) {
  const settings = await Setting.findOne();
  const storeName = settings?.siteName || 'Your Store Name';

  const response = await fetch(blobUrl);
  const pdfBuffer = await response.buffer();

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.ADMIN_EMAIL,
    subject: `${storeName} - Daily Transaction Report - ${date.toISOString().split('T')[0]}`,
    text: `Please find attached the daily transaction report for ${storeName} on ${date.toISOString().split('T')[0]}.`,
    attachments: [
      {
        filename: `daily_report_${date.toISOString().split('T')[0]}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  await transporter.sendMail(mailOptions);
}

module.exports = { sendDailyReportEmail };