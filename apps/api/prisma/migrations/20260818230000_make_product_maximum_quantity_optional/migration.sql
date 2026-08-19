-- Keep existing maximum quantity values, but allow new products to use stock as their limit.
ALTER TABLE "Product"
  ALTER COLUMN "maximumQuantity" DROP DEFAULT,
  ALTER COLUMN "maximumQuantity" DROP NOT NULL;
