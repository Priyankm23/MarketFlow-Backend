import dns from "node:dns";
import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { env } from "../../config/env.js";

dns.setDefaultResultOrder("ipv4first");

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string, family: number) => void;

interface WelcomeEmailPayload {
  name: string;
  email: string;
}

interface OrderInvoiceItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderPlacedInvoiceEmailPayload {
  orderId: string;
  customerName: string;
  customerEmail: string;
  vendorName: string;
  orderDate: string;
  paymentReference: string;
  totalAmount: number;
  shippingAddress: string;
  items: OrderInvoiceItem[];
}

const transporterConfig: SMTPTransport.Options = {
  host: env.SMTP_SERVER,
  port: Number(env.SMTP_PORT),
  secure: Number(env.SMTP_PORT) === 465,
  requireTLS: Number(env.SMTP_PORT) !== 465,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  tls: {
    servername: env.SMTP_SERVER,
  },
};

const transporter = nodemailer.createTransport({
  ...transporterConfig,
  lookup: (
    hostname: string,
    _options: dns.LookupOneOptions,
    callback: LookupCallback,
  ) => {
    dns.lookup(hostname, { family: 4, all: false }, callback);
  },
} as SMTPTransport.Options);

const formatCurrency = (amount: number) => `Rs. ${amount.toFixed(2)}`;

export async function sendWelcomeEmail({ name, email }: WelcomeEmailPayload) {
  await transporter.sendMail({
    from: '"MyShop" <no-reply@myshop.com>',
    to: email,
    subject: "Welcome to MyShop! 🎉",
    html: `
      <h1>Hi ${name}, welcome aboard!</h1>
      <p>Your account is ready. Start shopping now.</p>
    `,
  });

  console.log(`📧 Welcome email sent to ${email}`);
}

export async function sendOrderPlacedInvoiceEmail(
  payload: OrderPlacedInvoiceEmailPayload,
) {
  const rowsHtml = payload.items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.productName}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(item.unitPrice)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(item.lineTotal)}</td>
        </tr>
      `,
    )
    .join("");

  await transporter.sendMail({
    from: '"MyShop Billing" <no-reply@myshop.com>',
    to: payload.customerEmail,
    subject: `Invoice for Order ${payload.orderId}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#111827;">
        <h1 style="margin-bottom:4px;">Order Invoice</h1>
        <p style="margin-top:0;color:#6b7280;">Thank you for your purchase, ${payload.customerName}.</p>

        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:16px 0;">
          <p style="margin:4px 0;"><strong>Order ID:</strong> ${payload.orderId}</p>
          <p style="margin:4px 0;"><strong>Order Date:</strong> ${payload.orderDate}</p>
          <p style="margin:4px 0;"><strong>Vendor:</strong> ${payload.vendorName}</p>
          <p style="margin:4px 0;"><strong>Payment Ref:</strong> ${payload.paymentReference}</p>
          <p style="margin:4px 0;"><strong>Shipping Address:</strong> ${payload.shippingAddress}</p>
        </div>

        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;border-bottom:2px solid #d1d5db;">Product</th>
              <th style="text-align:center;padding:8px;border-bottom:2px solid #d1d5db;">Qty</th>
              <th style="text-align:right;padding:8px;border-bottom:2px solid #d1d5db;">Unit Price</th>
              <th style="text-align:right;padding:8px;border-bottom:2px solid #d1d5db;">Line Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>

        <div style="margin-top:16px;text-align:right;">
          <p style="font-size:18px;margin:0;"><strong>Total: ${formatCurrency(payload.totalAmount)}</strong></p>
        </div>
      </div>
    `,
  });

  console.log(`📧 Order invoice email sent to ${payload.customerEmail}`);
}
