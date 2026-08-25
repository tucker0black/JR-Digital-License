import { Prisma } from '@prisma/client';

export interface PricingCoupon {
  id: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: Prisma.Decimal;
  minimumOrderAmount: Prisma.Decimal | null;
  maximumDiscountAmount: Prisma.Decimal | null;
  startAt: Date | null;
  endAt: Date | null;
  usageLimit: number | null;
  usageCount: number;
  perUserLimit: number | null;
  isActive: boolean;
  restrictedProductId: string | null;
  restrictedCategoryId: string | null;
}

export interface CouponEvaluation {
  valid: boolean;
  discount: Prisma.Decimal;
  error: string | null;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Calculates a coupon discount using Decimal arithmetic only. The caller is
 * responsible for checking the per-user usage limit inside its transaction.
 */
export function evaluateCoupon(
  coupon: PricingCoupon | null,
  subtotal: Prisma.Decimal,
  productId: string,
  categoryId: string,
  now = new Date()
): CouponEvaluation {
  if (!coupon) return { valid: false, discount: ZERO, error: 'Invalid coupon code' };
  if (!coupon.isActive) return { valid: false, discount: ZERO, error: 'Coupon is disabled' };
  if (coupon.startAt && coupon.startAt > now) return { valid: false, discount: ZERO, error: 'Coupon is not yet active' };
  if (coupon.endAt && coupon.endAt <= now) return { valid: false, discount: ZERO, error: 'Coupon has expired' };
  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, discount: ZERO, error: 'Coupon usage limit reached' };
  }
  if (coupon.restrictedProductId && coupon.restrictedProductId !== productId) {
    return { valid: false, discount: ZERO, error: 'Coupon is not valid for this product' };
  }
  if (coupon.restrictedCategoryId && coupon.restrictedCategoryId !== categoryId) {
    return { valid: false, discount: ZERO, error: 'Coupon is not valid for this product category' };
  }
  if (coupon.minimumOrderAmount && subtotal.lessThan(coupon.minimumOrderAmount)) {
    return {
      valid: false,
      discount: ZERO,
      error: `Minimum order amount is ${coupon.minimumOrderAmount.toFixed(2)}`
    };
  }

  let discount = coupon.discountType === 'PERCENTAGE'
    ? subtotal.mul(coupon.discountValue).div(100)
    : coupon.discountValue;

  if (coupon.maximumDiscountAmount && discount.greaterThan(coupon.maximumDiscountAmount)) {
    discount = coupon.maximumDiscountAmount;
  }

  discount = Prisma.Decimal.min(discount, subtotal).toDecimalPlaces(2);
  return { valid: true, discount, error: null };
}

export function effectiveProductPrice(
  normalPrice: Prisma.Decimal,
  promotionalPrice?: Prisma.Decimal | null
): Prisma.Decimal {
  if (!promotionalPrice || promotionalPrice.isNegative() || promotionalPrice.isZero()) {
    return normalPrice;
  }
  return promotionalPrice.lessThan(normalPrice) ? promotionalPrice : normalPrice;
}
