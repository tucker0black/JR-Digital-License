declare module 'bakong-khqr' {
  export const khqrData: {
    currency: {
      usd: number;
      khr: number;
    };
  };

  export class MerchantInfo {
    constructor(
      bakongAccountID: string,
      merchantName: string,
      merchantCity: string,
      merchantID: string,
      acquiringBank?: string,
      optional?: Record<string, unknown>
    );
  }

  export class IndividualInfo {
    constructor(
      bakongAccountID: string,
      merchantName: string,
      merchantCity: string,
      optional?: Record<string, unknown>
    );
  }

  export class BakongKHQR {
    generateMerchant(merchantInfo: MerchantInfo): {
      status: { code: number; errorCode?: number | null; message?: string | null };
      data: { qr: string; md5: string } | null;
    };
    generateIndividual(individualInfo: IndividualInfo): {
      status: { code: number; errorCode?: number | null; message?: string | null };
      data: { qr: string; md5: string } | null;
    };
    static verify(khqrString: string): { isValid: boolean };
    static decode(khqrString: string): unknown;
  }
}
