-- Persistent customer-chosen UI language for the Telegram bot ('km' | 'en').
-- Nullable: NULL means the customer has not chosen a language yet and the bot
-- shows the language selection prompt. Existing rows are untouched.
-- Distinct from "languageCode", which mirrors the Telegram client locale.
ALTER TABLE "User" ADD COLUMN "language" TEXT;
