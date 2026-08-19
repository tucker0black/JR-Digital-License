import { BakongKHQR, khqrData, IndividualInfo } from 'bakong-khqr';
import QRCode from 'qrcode';

export interface GenerateKhqrParams {
  accountId: string;
  merchantName: string;
  merchantCity?: string;
  amount: string | number;
  currency: 'USD' | 'KHR';
  billNumber: string;
  expiresAt: Date;
  storeLabel?: string;
  terminalLabel?: string;
}

export interface GeneratedKhqr {
  qr: string;
  md5: string;
}

export function parseKhqrFields(payload: string): Map<string, string> {
  const fields = new Map<string, string>();
  let offset = 0;

  while (offset < payload.length) {
    if (offset + 4 > payload.length) {
      throw new Error('KHQR payload contains a truncated field');
    }

    const tag = payload.slice(offset, offset + 2);
    const lengthText = payload.slice(offset + 2, offset + 4);
    const length = Number.parseInt(lengthText, 10);

    if (!Number.isInteger(length) || length < 0) {
      throw new Error('KHQR payload contains an invalid field length');
    }

    const valueStart = offset + 4;
    const valueEnd = valueStart + length;
    if (valueEnd > payload.length) {
      throw new Error('KHQR payload contains a field longer than the payload');
    }

    fields.set(tag, payload.slice(valueStart, valueEnd));
    offset = valueEnd;
  }

  return fields;
}

function normalizeAmount(value: string | number): string {
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return raw;

  const [whole = '', fractional = ''] = raw.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  const normalizedFractional = fractional.replace(/0+$/, '');
  return normalizedFractional ? `${normalizedWhole}.${normalizedFractional}` : normalizedWhole;
}

export function validateDynamicKhqr(params: GenerateKhqrParams, generated: GeneratedKhqr): void {
  if (!BakongKHQR.verify(generated.qr).isValid) {
    throw new Error('Bakong returned an invalid KHQR payload');
  }

  const fields = parseKhqrFields(generated.qr);
  if (fields.get('01') !== '12') {
    throw new Error('Bakong returned a static KHQR; dynamic payments require static=false');
  }

  const expectedCurrencyCode = params.currency === 'USD' ? '840' : '116';
  if (fields.get('53') !== expectedCurrencyCode) {
    throw new Error('Bakong returned a KHQR with the wrong currency');
  }

  if (normalizeAmount(fields.get('54') ?? '') !== normalizeAmount(params.amount)) {
    throw new Error('Bakong returned a KHQR with the wrong amount');
  }

  if (fields.get('58') !== 'KH') {
    throw new Error('Bakong returned a KHQR with the wrong country code');
  }

  if (fields.get('59') !== params.merchantName) {
    throw new Error('Bakong returned a KHQR with the wrong merchant name');
  }

  const accountField = fields.get('29') ?? fields.get('30') ?? '';
  if (!accountField.includes(params.accountId)) {
    throw new Error('Bakong returned a KHQR for the wrong receiving account');
  }

  const additionalData = fields.get('62') ?? '';
  const additionalFields = parseKhqrFields(additionalData);
  if (additionalFields.get('01') !== params.billNumber) {
    throw new Error('Bakong returned a KHQR with the wrong bill number');
  }
}

export function generateMerchantKhqr(params: GenerateKhqrParams): GeneratedKhqr {
  const amount = String(params.amount);

  if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error('Amount must be a positive number');
  }

  const billNumber = params.billNumber;
  if (!billNumber || billNumber.length > 25) {
    throw new Error('billNumber is required and must be at most 25 characters');
  }

  const merchantName = params.merchantName;
  if (!merchantName || merchantName.length > 25) {
    throw new Error('merchantName is required and must be at most 25 characters');
  }

  const merchantCity = params.merchantCity || 'Phnom Penh';
  if (merchantCity.length > 15) {
    throw new Error('merchantCity must be at most 15 characters');
  }

  const currency = params.currency.toUpperCase() === 'KHR' ? khqrData.currency.khr : khqrData.currency.usd;

  // The official account_id flow uses the individual account template (29).
  // It does not require inventing a bank-issued merchant ID or acquiring code.
  const merchantInfo = new IndividualInfo(
    params.accountId,
    merchantName,
    merchantCity,
    {
      currency,
      amount,
      billNumber,
      storeLabel: params.storeLabel,
      terminalLabel: params.terminalLabel,
      expirationTimestamp: params.expiresAt.getTime()
    }
  );

  const response = new BakongKHQR().generateIndividual(merchantInfo);

  if (response.status.code !== 0 || !response.data) {
    throw new Error(response.status.message || 'Failed to generate KHQR');
  }

  const generated = { qr: response.data.qr, md5: response.data.md5 };
  validateDynamicKhqr(params, generated);
  return generated;
}

export async function renderQrImage(qr: string): Promise<string> {
  return QRCode.toDataURL(qr, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512
  });
}
