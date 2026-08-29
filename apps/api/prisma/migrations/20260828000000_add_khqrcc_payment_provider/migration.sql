-- Add KHQRCC to the PaymentProvider enum.
-- Idempotent: safe to run on databases that already have the value (e.g. manually patched).

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'KHQRCC'
        AND enumtypid = (
            SELECT oid FROM pg_type WHERE typname = 'PaymentProvider'
        )
    ) THEN
        ALTER TYPE "PaymentProvider" ADD VALUE 'KHQRCC';
    END IF;
END $$;
