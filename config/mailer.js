const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,  // Gmail App Password
    },
});

/**
 * Send a registration ticket email with an embedded QR code.
 * Silently fails so it never blocks the registration flow.
 */
async function sendTicketEmail({ to, participantName, eventTitle, eventDate, venue, ticketId, qrPayload }) {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.log('Email not configured – skipping ticket email');
            return;
        }

        // Generate QR code as a base64 data URL
        const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 250, margin: 2 });
        const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');

        const formattedDate = eventDate
            ? new Date(eventDate).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
            : 'TBA';

        const mailOptions = {
            from: `"Felicity Events" <${process.env.EMAIL_USER}>`,
            to,
            subject: `🎟️ Your Ticket for ${eventTitle}`,
            html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                    <!-- Header -->
                    <div style="background: linear-gradient(135deg, #6366f1, #a855f7); padding: 28px 24px; text-align: center;">
                        <h1 style="color: #fff; margin: 0; font-size: 22px;">🎉 Registration Confirmed!</h1>
                    </div>

                    <!-- Body -->
                    <div style="padding: 28px 24px;">
                        <p style="color: #374151; font-size: 15px; margin: 0 0 18px;">
                            Hi <strong>${participantName || 'there'}</strong>, you're all set!
                        </p>

                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280; font-size: 13px; width: 110px;">Event</td>
                                <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${eventTitle}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280; font-size: 13px;">Date</td>
                                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${formattedDate}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280; font-size: 13px;">Venue</td>
                                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${venue || 'TBA'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280; font-size: 13px;">Ticket ID</td>
                                <td style="padding: 8px 0; color: #111827; font-size: 14px; font-family: monospace;">${ticketId}</td>
                            </tr>
                        </table>

                        <!-- QR Code -->
                        <div style="text-align: center; padding: 16px; background: #f9fafb; border-radius: 8px; margin-bottom: 18px;">
                            <p style="color: #6b7280; font-size: 12px; margin: 0 0 10px;">Show this QR code at the venue for check-in</p>
                            <img src="cid:ticket-qr" alt="Ticket QR Code" style="width: 200px; height: 200px;" />
                        </div>

                        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
                            This ticket is also available in your Participation History on the Felicity platform.
                        </p>
                    </div>

                    <!-- Footer -->
                    <div style="background: #f3f4f6; padding: 14px 24px; text-align: center;">
                        <p style="color: #9ca3af; font-size: 11px; margin: 0;">Felicity — Event Management Platform</p>
                    </div>
                </div>
            `,
            attachments: [
                {
                    filename: 'ticket-qr.png',
                    content: qrBase64,
                    encoding: 'base64',
                    cid: 'ticket-qr',
                },
            ],
        };

        await transporter.sendMail(mailOptions);
        console.log(`Ticket email sent to ${to} for event "${eventTitle}"`);
    } catch (error) {
        console.error('Failed to send ticket email:', error.message);
        // Never throw – email failure should not block registration
    }
}

module.exports = { sendTicketEmail };
