import AsyncStorage from '@react-native-async-storage/async-storage';

interface ReceiptData {
  transactionId: string;
  type: 'remittance' | 'bill_payment' | 'transfer' | 'deposit' | 'withdrawal';
  amount: string;
  currency: string;
  senderName: string;
  recipientName?: string;
  recipientAccount?: string;
  recipientBank?: string;
  exchangeRate?: string;
  receivedAmount?: string;
  receivedCurrency?: string;
  fee?: string;
  status: string;
  date: string;
  referenceNumber: string;
  paymentMethod?: string;
  payoutMethod?: string;
  description?: string;
}

interface GeneratedReceipt {
  id: string;
  html: string;
  data: ReceiptData;
  createdAt: string;
}

class ReceiptService {
  private readonly RECEIPTS_KEY = 'generated_receipts';

  generateReceiptHTML(data: ReceiptData): string {
    const formattedDate = new Date(data.date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const typeLabels: Record<string, string> = {
      remittance: 'Money Transfer',
      bill_payment: 'Bill Payment',
      transfer: 'Transfer',
      deposit: 'Deposit',
      withdrawal: 'Withdrawal',
    };

    const statusColors: Record<string, string> = {
      completed: '#00A651',
      pending: '#F59E0B',
      failed: '#EF4444',
    };

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .receipt {
      max-width: 400px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #00A651 0%, #008844 100%);
      color: white;
      padding: 24px;
      text-align: center;
    }
    .logo {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .subtitle { font-size: 14px; opacity: 0.9; }
    .status-badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      margin-top: 12px;
      background: ${statusColors[data.status] || '#666'};
    }
    .amount-section {
      padding: 24px;
      text-align: center;
      border-bottom: 1px dashed #e5e5e5;
    }
    .amount-label { font-size: 14px; color: #666; margin-bottom: 4px; }
    .amount-value { font-size: 36px; font-weight: 700; color: #00A651; }
    .amount-currency { font-size: 18px; color: #666; margin-left: 4px; }
    .details { padding: 20px 24px; }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #888; font-size: 14px; }
    .detail-value { 
      color: #333; 
      font-size: 14px; 
      font-weight: 500;
      text-align: right;
      max-width: 60%;
    }
    .exchange-info {
      background: #f8f9fa;
      padding: 16px 24px;
      margin: 0 24px 20px;
      border-radius: 12px;
    }
    .exchange-row {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      margin-bottom: 8px;
    }
    .exchange-row:last-child { margin-bottom: 0; }
    .footer {
      background: #f8f9fa;
      padding: 20px 24px;
      text-align: center;
    }
    .ref-number {
      font-family: monospace;
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
    }
    .footer-note {
      font-size: 12px;
      color: #888;
      line-height: 1.5;
    }
    .ethiopian-flag {
      display: flex;
      justify-content: center;
      gap: 4px;
      margin-top: 16px;
    }
    .flag-stripe {
      width: 40px;
      height: 8px;
      border-radius: 2px;
    }
    .green { background: #00A651; }
    .yellow { background: #FCDD09; }
    .red { background: #DA121A; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="logo">💸 Sumsuma</div>
      <div class="subtitle">${typeLabels[data.type] || 'Transaction'} Receipt</div>
      <div class="status-badge">${data.status}</div>
    </div>
    
    <div class="amount-section">
      <div class="amount-label">Amount Sent</div>
      <div class="amount-value">
        ${data.amount}<span class="amount-currency">${data.currency}</span>
      </div>
    </div>

    ${data.exchangeRate && data.receivedAmount ? `
    <div class="exchange-info">
      <div class="exchange-row">
        <span>Exchange Rate</span>
        <span>1 ${data.currency} = ${data.exchangeRate} ${data.receivedCurrency || 'ETB'}</span>
      </div>
      <div class="exchange-row">
        <span>Amount Received</span>
        <span style="color: #00A651; font-weight: 600;">
          ${data.receivedAmount} ${data.receivedCurrency || 'ETB'}
        </span>
      </div>
    </div>
    ` : ''}

    <div class="details">
      <div class="detail-row">
        <span class="detail-label">Transaction ID</span>
        <span class="detail-value">${data.transactionId}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Date & Time</span>
        <span class="detail-value">${formattedDate}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Sender</span>
        <span class="detail-value">${data.senderName}</span>
      </div>
      ${data.recipientName ? `
      <div class="detail-row">
        <span class="detail-label">Recipient</span>
        <span class="detail-value">${data.recipientName}</span>
      </div>
      ` : ''}
      ${data.recipientBank ? `
      <div class="detail-row">
        <span class="detail-label">Institution</span>
        <span class="detail-value">${data.recipientBank}</span>
      </div>
      ` : ''}
      ${data.recipientAccount ? `
      <div class="detail-row">
        <span class="detail-label">Account</span>
        <span class="detail-value">****${data.recipientAccount.slice(-4)}</span>
      </div>
      ` : ''}
      ${data.paymentMethod ? `
      <div class="detail-row">
        <span class="detail-label">Payment Method</span>
        <span class="detail-value">${data.paymentMethod}</span>
      </div>
      ` : ''}
      ${data.payoutMethod ? `
      <div class="detail-row">
        <span class="detail-label">Payout Method</span>
        <span class="detail-value">${data.payoutMethod}</span>
      </div>
      ` : ''}
      ${data.fee ? `
      <div class="detail-row">
        <span class="detail-label">Fee</span>
        <span class="detail-value">${data.fee} ${data.currency}</span>
      </div>
      ` : ''}
      ${data.description ? `
      <div class="detail-row">
        <span class="detail-label">Description</span>
        <span class="detail-value">${data.description}</span>
      </div>
      ` : ''}
    </div>

    <div class="footer">
      <div class="ref-number">Ref: ${data.referenceNumber}</div>
      <div class="footer-note">
        Thank you for using Sumsuma!<br/>
        Keep this receipt for your records.
      </div>
      <div class="ethiopian-flag">
        <div class="flag-stripe green"></div>
        <div class="flag-stripe yellow"></div>
        <div class="flag-stripe red"></div>
      </div>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  generateReferenceNumber(): string {
    const prefix = 'NB';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  async generateReceipt(data: ReceiptData): Promise<GeneratedReceipt> {
    const html = this.generateReceiptHTML(data);
    const receipt: GeneratedReceipt = {
      id: `receipt_${Date.now()}`,
      html,
      data,
      createdAt: new Date().toISOString(),
    };

    await this.saveReceipt(receipt);
    return receipt;
  }

  private async saveReceipt(receipt: GeneratedReceipt): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(this.RECEIPTS_KEY);
      const receipts: GeneratedReceipt[] = stored ? JSON.parse(stored) : [];
      receipts.unshift(receipt);
      
      const limitedReceipts = receipts.slice(0, 50);
      await AsyncStorage.setItem(this.RECEIPTS_KEY, JSON.stringify(limitedReceipts));
    } catch (error) {
      console.error('Failed to save receipt:', error);
    }
  }

  async getReceipts(): Promise<GeneratedReceipt[]> {
    try {
      const stored = await AsyncStorage.getItem(this.RECEIPTS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to get receipts:', error);
      return [];
    }
  }

  async getReceiptById(id: string): Promise<GeneratedReceipt | null> {
    const receipts = await this.getReceipts();
    return receipts.find(r => r.id === id) || null;
  }

  async shareReceipt(receipt: GeneratedReceipt): Promise<void> {
    console.log('Share receipt:', receipt.id);
  }

  async printReceipt(receipt: GeneratedReceipt): Promise<void> {
    console.log('Print receipt:', receipt.id);
  }
}

export const receiptService = new ReceiptService();
export type { ReceiptData, GeneratedReceipt };
