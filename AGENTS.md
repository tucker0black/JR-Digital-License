# JR DIGITAL LICENSE — MASTER PROJECT SPECIFICATION

## 1. PROJECT OVERVIEW

Build a production-ready Telegram Bot + Telegram Mini App for:

# JR Digital license

This is a digital products and SMM service store operated through Telegram.

The application must be modern, secure, responsive, database-driven, and easy for a non-programmer administrator to manage.

The application must NOT be a simple visual demo.

Build a real system with:

- Telegram Bot
- Telegram Mini App
- Telegram authentication
- PostgreSQL database
- Admin Dashboard
- Product management
- Dynamic pricing
- Digital product inventory
- Automatic digital delivery
- Order management
- KHQR/Bakong payment architecture
- Wallet/balance system
- SMM provider integration architecture
- Telegram group notifications
- Customer support
- Security
- Audit logs
- Testing
- Deployment configuration

==================================================
2. MOST IMPORTANT BUSINESS REQUIREMENT
==================================================

The store must be completely DATABASE-DRIVEN.

After the application is deployed, I must NOT need to edit source code whenever I want to:

- Add a product
- Delete/disable a product
- Change a product price
- Change a product name
- Change a product description
- Change a product image
- Change a product category
- Change product stock
- Change product instructions
- Change minimum quantity
- Change maximum quantity
- Change product status
- Change product visibility
- Change SMM service ID
- Change provider
- Change provider cost
- Change markup
- Add an SMM service
- Disable an SMM service
- Add a category
- Change category information
- Feature/unfeature a product
- Mark a product as popular

All normal store management must be possible through the Admin Dashboard.

Do NOT hardcode the product catalog into frontend source code.

Do NOT hardcode product prices.

Do NOT require a developer to modify JavaScript/TypeScript files for normal product management.

==================================================
3. BRANDING
==================================================

The official application name is:

JR Digital license

Use this exact name throughout the application.

Do NOT use:

MENG STORE
MENG SMM
MengSMM

The Telegram Bot and Mini App branding should use:

JR Digital license

Create a modern premium digital-store identity.

==================================================
4. CUSTOMER LOGIN EXPERIENCE
==================================================

There must be NO normal login page.

There must be NO registration page.

There must be NO email/password login.

The user opens the Telegram Mini App from Telegram.

The application automatically identifies the Telegram user.

The Mini App should automatically show:

- Telegram profile photo
- First name
- Last name if available
- Telegram username
- Telegram ID internally
- Account balance

Example:

Jim Rotha
@jimrotha

Balance:
$0.00

The user should feel already logged in.

==================================================
5. TELEGRAM MINI APP AUTHENTICATION
==================================================

Use Telegram Mini App authentication.

The frontend should obtain:

Telegram.WebApp.initData

Send the raw initData to the backend.

The backend MUST validate Telegram's signed initialization data.

Never trust:

Telegram.WebApp.initDataUnsafe

as authentication.

Never trust a telegram_id sent directly by the frontend.

The backend must validate the Telegram signature using the Telegram Bot Token before accepting the identity.

After successful authentication:

1. Find the Telegram user.
2. Create the user if they do not exist.
3. Update their Telegram profile information.
4. Create a secure application session.
5. Return the authenticated user profile and balance.

Use BIGINT-compatible storage for Telegram IDs.

==================================================
6. USER MODEL
==================================================

Create a User model with at least:

- id
- telegramId
- username
- firstName
- lastName
- photoUrl
- languageCode
- balance or derived wallet balance
- status
- createdAt
- updatedAt
- lastSeenAt

Default:

status = ACTIVE

No registration form should be required.

==================================================
7. TECHNOLOGY STACK
==================================================

Use a TypeScript-based architecture.

Recommended structure:

apps/
  bot/
  miniapp/
  api/

packages/
  shared/

Frontend:

- Next.js
- React
- TypeScript
- Tailwind CSS

Backend:

- Node.js
- TypeScript
- REST API
- Service-oriented architecture

Database:

- PostgreSQL
- Prisma ORM

Caching / queues / background jobs:

- Redis

Telegram:

- Telegram Bot API
- grammY or Telegraf

Use a clean architecture.

Keep:

UI
API
business logic
database
external integrations

separated.

==================================================
8. PROJECT STRUCTURE
==================================================

Use a monorepo structure similar to:

apps/
  bot/
  miniapp/
  api/

packages/
  shared/

apps/bot:
Telegram bot handlers and Telegram-specific interactions.

apps/miniapp:
Telegram Mini App frontend.

apps/api:
Backend API, business logic, payment processing, order processing and background workers.

packages/shared:
Shared TypeScript types, schemas, validation, constants and utilities.

Do not put all logic into one file.

==================================================
9. DATABASE
==================================================

Use PostgreSQL with Prisma.

Create migrations for:

- users
- admins
- roles
- permissions
- categories
- products
- product variants
- product stock
- orders
- order items
- fulfillment records
- payments
- payment events
- wallets
- wallet transactions
- SMM providers
- SMM services
- SMM orders
- support tickets
- support messages
- Telegram notification targets
- notifications
- audit logs
- security events
- application settings

Use:

- indexes
- unique constraints
- foreign keys
- timestamps
- status enums
- transactions

==================================================
10. TELEGRAM BOT
==================================================

Create the Telegram Bot for:

JR Digital license

Support:

/start
/balance
/orders
/help
/support

The /start message should welcome the user.

Example:

👋 Welcome to JR Digital license!

🚀 Buy digital products and SMM services directly through our Telegram Mini App.

Buttons:

[🚀 Open JR Digital license]

[💰 Balance]

The bot should also provide:

- Mini App launch button
- Balance
- Orders
- Support
- Important notifications

Keep business logic in the backend.

Do not put complex business logic directly inside Telegram handlers.

==================================================
11. TELEGRAM MINI APP
==================================================

Create a modern responsive Mini App.

Main sections:

- Home
- Store
- Orders
- Wallet
- Support

The Mini App should feel native to Telegram.

Support:

- Telegram theme
- dark mode
- light mode where appropriate
- safe-area insets
- mobile screens
- desktop Telegram where possible

Use modern animations.

Keep animations subtle and professional.

==================================================
12. DESIGN STYLE
==================================================

Design should be:

- modern
- premium
- clean
- dark
- mobile-first
- responsive
- professional
- smooth
- minimal
- easy to navigate

Use:

- dark navy/black background
- dark cards
- blue/cyan accent
- purple secondary accent
- green success
- red errors
- subtle borders
- subtle gradients

Do not make the design excessively neon.

Do not make the interface look cheap.

Use the reference screenshots only as inspiration.

Do not copy the original MENG STORE branding.

Create a better JR Digital license interface.

==================================================
13. HOME PAGE
==================================================

Show:

- Telegram profile
- Balance
- Deposit button
- Search
- Categories
- Featured products
- Popular products
- Recent orders
- Promotional banner
- Quick actions

Example:

[Avatar]

Jim Rotha
@jimrotha

Balance
$0.00

[+ Deposit]

==================================================
14. BOTTOM NAVIGATION
==================================================

Use:

Home
Store
Orders
Wallet
Support

Make it optimized for Telegram mobile screens.

==================================================
15. CATEGORIES
==================================================

Example categories may include:

Facebook
TikTok
Instagram
Telegram
YouTube
Digital Accounts
Gift Cards
Design & Tools
Other

BUT categories must NOT be hardcoded.

Categories must come from PostgreSQL.

Admin must be able to:

- add category
- edit category
- disable category
- archive category
- reorder category
- change category image
- change category icon
- change category description

==================================================
16. PRODUCT SYSTEM
==================================================

Products must come from PostgreSQL.

Never hardcode the catalog in frontend code.

Each product should support:

- id
- name
- description
- image
- category
- type
- deliveryType
- price
- currency
- costPrice
- markup
- minimumQuantity
- maximumQuantity
- stock
- status
- isActive
- isFeatured
- isPopular
- sortOrder
- instructions
- createdAt
- updatedAt

==================================================
17. PRODUCT TYPES
==================================================

Support:

DIGITAL_LINK
DIGITAL_CODE
DIGITAL_TEXT
DIGITAL_FILE
DIGITAL_ACCOUNT
SMM_API

The architecture should allow new product types in the future.

==================================================
18. PRODUCT SEARCH
==================================================

Create:

"Search products or services..."

Search by:

- product name
- service name
- service ID
- category
- keywords

Use debounced search.

Search ONLY active/visible products.

Disabled products must NOT appear.

==================================================
19. DYNAMIC PRODUCT MANAGEMENT
==================================================

Create a complete Product Management section inside Admin Dashboard.

Admin should see:

- Product image
- Product name
- Category
- Price
- Stock
- Type
- Status
- Last updated

Actions:

[Edit]
[Duplicate]
[Stock]
[Enable]
[Disable]
[Archive]
[Orders]
[History]

==================================================
20. ADD PRODUCT
==================================================

Admin can click:

+ Add Product

Fields:

Product Name
Product Description
Product Image
Category
Product Type
Delivery Type
Price
Currency
Minimum Quantity
Maximum Quantity
Stock
SMM Provider
SMM Service ID
Provider Cost
Markup
Instructions
Status
Featured
Popular
Sort Order

Click:

[Create Product]

The product must be saved to PostgreSQL.

The Mini App must automatically display it.

No frontend code change.

No redeployment.

No developer intervention.

==================================================
21. EDIT PRODUCT
==================================================

Admin can edit any product.

Example:

Current:

Gemini 18 Month
$2.60

Admin changes:

$3.00

Click:

[Save Changes]

New customers must see:

$3.00

No source-code modification.

==================================================
22. PRICE SECURITY
==================================================

Never trust frontend prices.

Never trust frontend totals.

Never trust frontend discounts.

The backend must retrieve the current price from PostgreSQL.

The backend calculates:

unit price
quantity
subtotal
discount
total

The final amount sent to the payment system must come from the backend.

==================================================
23. HISTORICAL PRICE SNAPSHOT
==================================================

When an order is created, save:

- productNameSnapshot
- unitPriceSnapshot
- quantitySnapshot
- totalSnapshot
- currencySnapshot
- deliveryTypeSnapshot
- providerServiceIdSnapshot when relevant

Example:

Order #59:

Gemini 18 Month
$2.60

Admin later changes:

$3.00

Order #59 MUST remain:

Gemini 18 Month
$2.60

New orders use:

$3.00

Never calculate historical order totals from the current product price.

==================================================
24. ADDING NEW PRODUCTS
==================================================

Admin can add unlimited products.

Example:

Gemini 24 Month
$4.50
Digital Link

After saving:

The product automatically appears in its category.

No source code changes.

==================================================
25. PRODUCT DISABLE / DELETE
==================================================

Use SAFE deletion.

If a product has historical orders:

DO NOT physically delete the database record.

Instead use:

isActive = false

status = DISABLED

or:

status = ARCHIVED

When disabled:

The product must disappear from:

- Home
- Store
- Categories
- Search
- Featured
- Popular
- Recommendations

Customers must NOT be able to purchase it.

==================================================
26. DIRECT PRODUCT ACCESS
==================================================

If a customer knows the ID of a disabled product:

GET /api/products/:id

must not expose the disabled product.

Return:

404

or an appropriate unavailable response.

Do not rely only on hiding the product in the frontend.

==================================================
27. PRODUCT SEARCH SECURITY
==================================================

Search queries must only return:

ACTIVE
visible

products.

Example:

Admin disables:

Gemini 18 Month

Customer searches:

Gemini

The disabled product must not appear.

==================================================
28. OUT OF STOCK
==================================================

If digital stock reaches:

0

show:

Out of Stock

Disable:

[Buy]

Admin should have:

Hide when out of stock

ON/OFF

If ON:

Hide the product.

If OFF:

Show the product but disable purchasing.

==================================================
29. PRODUCT STATUS
==================================================

Use:

ACTIVE
DISABLED
DRAFT
OUT_OF_STOCK
ARCHIVED

Customer-facing APIs must only return products that are allowed to be visible.

==================================================
30. PRODUCT VISIBILITY
==================================================

Fields:

isActive
isFeatured
isPopular
status
sortOrder

Admin can control all of these.

==================================================
31. PRODUCT DUPLICATION
==================================================

Add:

[Duplicate]

Admin can duplicate an existing product.

Example:

Gemini 18 Month

Duplicate:

Gemini 24 Month

Then edit:

name
price
stock
description
etc.

==================================================
32. BULK PRODUCT MANAGEMENT
==================================================

Prepare support for:

- select multiple products
- disable selected
- enable selected
- archive selected
- change category
- export

Dangerous actions require confirmation.

==================================================
33. PRODUCT CHANGE HISTORY
==================================================

Every important product change must be recorded.

Create AuditLog entries for:

- product created
- product edited
- price changed
- stock changed
- product disabled
- product enabled
- product archived
- category changed

Store:

- admin
- product
- action
- old value
- new value
- timestamp

Example:

Product:
Gemini 18 Month

Action:
PRICE_CHANGED

Old:
$2.60

New:
$3.00

==================================================
34. DIGITAL PRODUCT STOCK
==================================================

Digital products can have individual inventory.

Example:

Gemini 18 Month

Stock:

37

Create ProductStock records.

Fields:

id
productId
deliveryValue
deliveryType
status
orderId
createdAt
soldAt

Statuses:

AVAILABLE
RESERVED
SOLD
DISABLED

When a customer purchases:

1. Reserve stock atomically.
2. Verify payment.
3. Deliver the reserved item.
4. Mark it SOLD.
5. Link it to the order.

Never allow two customers to receive the same stock item.

==================================================
35. DIGITAL DELIVERY
==================================================

Support:

DIGITAL_LINK
DIGITAL_CODE
DIGITAL_TEXT
DIGITAL_FILE
DIGITAL_ACCOUNT

After successful payment:

Deliver automatically.

Example:

🎉 Digital Purchase Completed!

📦 Product:
Gemini 18 Month Link

🆔 Order:
#59

💰 Amount:
$2.60 USD

🔑 Your Product:

[PRIVATE DELIVERY]

📖 Instructions:

...

Private product information must NEVER be posted in public groups.

==================================================
36. DELIVERY SECURITY
==================================================

Delivery must happen exactly once.

Use:

- transactions
- idempotency
- delivery records
- stock reservation
- status checks

If a payment confirmation is received twice:

DO NOT deliver twice.

If a Telegram webhook is received twice:

DO NOT create duplicate orders.

If a background worker runs twice:

DO NOT duplicate delivery.

==================================================
37. ORDER NUMBERS
==================================================

Every order must have:

- internal UUID
- human-readable order number

Examples:

#59
#60
#61

Do not rely only on the database ID.

==================================================
38. ORDER STATUS
==================================================

Use statuses such as:

DRAFT
PAYMENT_PENDING
PAID
PROCESSING
FULFILLING
COMPLETED
CANCELLED
EXPIRED
DELIVERY_FAILED
REFUNDED

Use a proper state machine.

==================================================
39. ORDER FLOW
==================================================

Customer:

Select product
↓
View product
↓
Select quantity if needed
↓
Checkout
↓
Create order
↓
Create payment
↓
Pay
↓
Server verifies payment
↓
Order becomes PAID
↓
Fulfillment starts
↓
Product delivered
↓
Order COMPLETED

==================================================
40. SMM SERVICES
==================================================

Support SMM products.

Examples:

Facebook Followers
Facebook Likes
Facebook Video Views
Instagram Followers
Telegram Reactions
YouTube Views
TikTok Services

Create:

SmmProvider
SmmService
SmmOrder

A product can map to:

- provider
- provider service ID
- provider cost
- selling price
- markup
- minimum quantity
- maximum quantity

==================================================
41. SMM PROVIDER ARCHITECTURE
==================================================

Create a provider adapter layer.

Do not tightly couple the application to one SMM panel.

Support:

- provider API URL
- provider API key
- provider name
- service ID
- provider cost
- status

Provider credentials must only exist on the backend/server.

Never expose SMM API keys to frontend.

==================================================
42. SMM ORDER FLOW
==================================================

Customer:

Select service
↓
Enter target
↓
Select quantity
↓
View calculated price
↓
Pay
↓
Server verifies payment
↓
Submit order to SMM provider
↓
Store external provider order ID
↓
Monitor status
↓
Update customer order

Statuses:

PENDING
PROCESSING
IN_PROGRESS
COMPLETED
PARTIAL
CANCELLED
FAILED
REFUNDED

Use background workers for status checking.

==================================================
43. WALLET / BALANCE
==================================================

Users have an internal wallet.

Create:

WalletTransaction

Fields:

id
userId
type
amount
currency
balanceBefore
balanceAfter
reference
status
createdAt

Types:

DEPOSIT
PURCHASE
REFUND
ADJUSTMENT
BONUS

Every balance change must create a transaction record.

Use the wallet ledger as the source of truth.

Prevent double spending using database transactions and locking.

==================================================
44. DEPOSIT
==================================================

Allow customers to deposit balance.

Example options:

$1
$2
$5
$10
$20
Custom amount

Create a payment session.

Verify payment server-side.

Only after confirmed payment:

Increase wallet balance.

Never allow the frontend to declare a deposit successful.

==================================================
45. KHQR / BAKONG
==================================================

Create a payment provider abstraction.

KHQR/Bakong must be an implementation of that payment abstraction.

Do not hardcode the entire application around one payment provider.

Payment provider should support:

createPayment()
verifyPayment()
getPaymentStatus()
expirePayment()

The exact Bakong/KHQR API implementation must be based on the current official provider/API documentation and actual merchant credentials.

Do not invent API endpoints.

Do not fake payment verification.

==================================================
46. KHQR PAYMENT FLOW
==================================================

When a customer creates an order:

1. Create order.
2. Calculate amount on backend.
3. Create payment intent.
4. Generate KHQR.
5. Store payment information.
6. Display QR to customer.
7. Monitor/verify payment server-side.
8. Confirm exact amount and reference.
9. Mark payment successful.
10. Mark order PAID.
11. Start fulfillment.
12. Send delivery.
13. Send Telegram notification.

Example payment screen:

KHQR AUTO PAYMENT

[QR CODE]

$2.00 USD

Merchant:
JR Digital license

Order:
#59

Expires in:
05:00

[Check Payment]

[Cancel]

==================================================
47. PAYMENT VERIFICATION
==================================================

Payment success MUST be determined by the backend.

Never trust:

- screenshot
- frontend button
- customer message
- client-side payment status

Verify server-to-server.

Check:

- payment reference
- amount
- currency
- order
- expiration
- payment status

Process callbacks/polling idempotently.

==================================================
48. PAYMENT IDEMPOTENCY
==================================================

If the same payment confirmation is received twice:

DO NOT:

- create another order
- add balance twice
- deliver twice
- submit SMM order twice

Use:

- unique constraints
- idempotency keys
- database transactions
- state validation

==================================================
49. PAYMENT EXPIRATION
==================================================

Unpaid payment sessions must expire.

Example:

Payment created:

12:00

Expires:

12:05

After expiration:

status = EXPIRED

The payment attempt must not be reused.

==================================================
50. TELEGRAM GROUP NOTIFICATIONS
==================================================

After a successful purchase, send a notification to a configured Telegram group.

Example:

🎉 NEW ORDER

🆔 Order: #59

📦 Product:
Gemini 18 Month Link

💰 Amount:
$2.60 USD

✅ Payment Confirmed

The group notification must NOT show:

- customer Telegram ID
- customer username
- private delivery
- password
- license key
- account credentials
- email
- payment secrets
- sensitive customer information

The group only needs to know that someone purchased a product.

==================================================
51. GROUP NOTIFICATION EVENTS
==================================================

Support notifications for:

- new paid order
- fulfillment failure
- low inventory
- failed payment
- expired payment
- refund
- wallet adjustment
- high-value/suspicious order

Allow admin to configure notification targets and event types.

Add rate limiting to prevent notification spam.

==================================================
52. CUSTOMER PRIVATE NOTIFICATIONS
==================================================

Customers can receive private messages for:

- successful payment
- order confirmation
- digital delivery
- SMM order status
- payment expiration
- refund
- support response

Private information must stay private.

==================================================
53. ORDERS PAGE
==================================================

Create:

All
Pending
Processing
Completed
Cancelled

Show:

Order number
Product
Price
Status
Date

Customer can open an order to see:

- order details
- payment status
- fulfillment status
- delivery information where appropriate
- instructions

==================================================
54. SUPPORT
==================================================

Create a support ticket system.

Fields:

subject
message
orderId
status

Statuses:

OPEN
IN_PROGRESS
RESOLVED
CLOSED

Customers can contact support.

Admins can reply.

==================================================
55. ADMIN DASHBOARD
==================================================

Create a secure Admin Dashboard.

Sections:

Dashboard
Users
Orders
Products
Categories
Stock
Payments
Deposits
Wallet
SMM Providers
SMM Services
Tickets
Notifications
Analytics
Settings
Audit Logs

==================================================
56. ADMIN PRODUCT MANAGEMENT
==================================================

Admin can:

- add product
- edit product
- duplicate product
- change price
- change image
- change description
- change category
- change stock
- change delivery
- change instructions
- enable product
- disable product
- archive product
- feature product
- unfeature product
- mark popular
- remove popular
- change sort order

All without editing source code.

==================================================
57. ADMIN ORDER MANAGEMENT
==================================================

Admin can:

- view orders
- search orders
- filter orders
- view payment status
- view fulfillment status
- retry failed delivery
- resend eligible digital delivery
- refund where supported
- manually review failed orders
- view order history

Do not allow unsafe actions without confirmation.

==================================================
58. ADMIN WALLET MANAGEMENT
==================================================

Admin can:

- view wallet
- view transactions
- make adjustments where authorized
- issue refunds
- add bonuses

Every manual adjustment requires:

- reason
- admin identity
- timestamp
- amount
- audit record

==================================================
59. ADMIN SECURITY
==================================================

Admin Dashboard must be protected.

Use:

- admin roles
- permissions
- authorized Telegram IDs/accounts
- server-side authorization
- audit logging
- rate limiting
- secure sessions

Never rely only on frontend hiding.

==================================================
60. PRODUCT CATEGORY MANAGEMENT
==================================================

Admin can:

- add category
- edit category
- disable category
- archive category
- change icon
- change image
- change description
- change sort order

Disabled categories must not appear to normal customers.

==================================================
61. ANALYTICS
==================================================

Admin Dashboard should provide:

- total sales
- orders
- completed orders
- pending orders
- failed orders
- refunds
- wallet deposits
- product sales
- top products
- stock
- SMM provider performance
- payment success/failure
- fulfillment failures

==================================================
62. AUTHORIZATION
==================================================

Use role-based access control.

Example roles:

SUPER_ADMIN
ADMIN
STAFF
SUPPORT

Permissions should control:

- product management
- order management
- payment management
- wallet management
- SMM management
- user management
- settings
- audit logs

==================================================
63. SECURITY
==================================================

Implement:

- Telegram initData validation
- server-side authentication
- server-side authorization
- input validation
- rate limiting
- secure headers
- database protection
- environment variables
- webhook validation
- idempotency
- transactions
- audit logging
- encrypted sensitive product inventory where appropriate

Never expose:

- API keys
- bot token
- payment credentials
- SMM provider credentials
- private customer information

==================================================
64. ENVIRONMENT VARIABLES
==================================================

Create:

.env.example

Include placeholders such as:

TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_ADMIN_GROUP_ID=

DATABASE_URL=

REDIS_URL=

APP_URL=

BAKONG_API_URL=
BAKONG_API_TOKEN=
BAKONG_MERCHANT_ACCOUNT=
BAKONG_MERCHANT_NAME=

SMM_API_URL=
SMM_API_KEY=

ADMIN_SECRET=

Never put real secrets in source code.

Never commit .env.

Create a .gitignore that excludes:

.env
.env.local
.env.production
node_modules
build output
secrets

==================================================
65. LOGGING
==================================================

Log:

- authentication events
- order creation
- payment creation
- payment verification
- payment success
- delivery
- delivery failure
- SMM requests
- SMM errors
- admin changes

Never log:

- API keys
- bot tokens
- passwords
- private delivery credentials
- sensitive payment secrets

==================================================
66. AUDIT LOG
==================================================

Create AuditLog.

Track:

- admin actions
- product changes
- price changes
- stock changes
- wallet adjustments
- refunds
- payment reconciliation
- order status changes
- SMM actions
- security events

==================================================
67. BACKGROUND WORKERS
==================================================

Create workers for:

- payment verification
- payment expiration
- SMM status checks
- delivery retries
- notification jobs
- stock alerts
- reconciliation

Use Redis queues where appropriate.

==================================================
68. PERFORMANCE
==================================================

Use:

- pagination
- database indexes
- debounced search
- lazy loading
- optimized images
- efficient API calls
- caching where appropriate

Do not load hundreds/thousands of products at once.

==================================================
69. RESPONSIVE DESIGN
==================================================

Support Telegram Mini App screens around:

320px
360px
390px
412px
430px

Also support larger screens.

No horizontal overflow.

==================================================
70. TESTING
==================================================

Create tests for:

- Telegram authentication
- invalid Telegram initData
- expired authentication
- user creation
- product search
- disabled product visibility
- product price changes
- historical order price
- product creation
- stock reservation
- duplicate payment
- duplicate delivery
- wallet deposits
- wallet double-spending prevention
- SMM orders
- admin authorization
- payment expiration
- refunds
- audit logs

Critical test:

If the same payment is confirmed twice:

Only ONE fulfillment must occur.

==================================================
71. IMPORTANT PRODUCT TEST
==================================================

Test:

Product:

Gemini 18 Month

Price:

$2.60

Create:

Order #59

Then admin changes price:

$3.00

Expected:

Order #59 remains:

$2.60

New Order #60:

$3.00

==================================================
72. IMPORTANT PRODUCT DISABLE TEST
==================================================

Product:

Gemini 18 Month

Admin disables product.

Expected:

Customer cannot:

- search for it
- see it in category
- see it in featured
- see it in popular
- purchase it
- access it directly

Historical Order #59 must still show:

Gemini 18 Month
$2.60

==================================================
73. DEPLOYMENT
==================================================

Prepare deployment architecture for:

- Mini App
- API
- Telegram Bot
- background workers
- PostgreSQL
- Redis

Mini App must run on HTTPS.

Configure:

Telegram Bot webhook
Telegram Mini App URL
API URL
database
Redis
production secrets

Create:

- Docker configuration
- Docker Compose for local development
- environment configuration
- migration commands
- production build
- CI configuration where appropriate

==================================================
74. DOCUMENTATION
==================================================

Create README.md containing:

- project overview
- installation
- requirements
- Node.js version
- package installation
- environment variables
- database setup
- Prisma setup
- migrations
- Redis setup
- Telegram Bot setup
- Mini App setup
- local development
- admin setup
- payment setup
- SMM setup
- deployment
- troubleshooting

==================================================
75. DEVELOPMENT STAGES
==================================================

Do NOT attempt to build the entire project in one giant operation.

Build in stages.

Stage 1:
Foundation and project architecture

Stage 2:
Database and Prisma

Stage 3:
Telegram Bot

Stage 4:
Telegram Mini App

Stage 5:
Telegram authentication

Stage 6:
Products/categories/search

Stage 7:
Dynamic Admin Product Management

Stage 8:
Orders and digital stock

Stage 9:
Payment architecture

Stage 10:
KHQR/Bakong integration

Stage 11:
Automatic digital delivery

Stage 12:
Telegram group notifications

Stage 13:
Wallet/balance

Stage 14:
SMM provider architecture

Stage 15:
Admin Dashboard

Stage 16:
Support system

Stage 17:
Security and audit logs

Stage 18:
Testing

Stage 19:
Deployment

==================================================
76. CODEX DEVELOPMENT WORKFLOW
==================================================

Before changing code:

1. Inspect the repository.
2. Read AGENTS.md.
3. Understand the current project.
4. Check package.json.
5. Check environment configuration.
6. Check database setup.
7. Create an implementation plan for the current stage.
8. Implement only the approved stage.
9. Run tests.
10. Run TypeScript checks.
11. Run linting.
12. Fix errors.
13. Verify the implementation.
14. Summarize what was changed.

Do not skip testing.

Do not make destructive changes without confirmation.

Do not delete working code without a clear reason.

Do not create duplicate systems.

Reuse existing components where appropriate.

==================================================
77. CODEX ERROR HANDLING
==================================================

If an error occurs:

Do not stop immediately.

Read the error.

Find the root cause.

Inspect the relevant files.

Fix the issue.

Run the command again.

Continue until the current stage works.

If an external service requires credentials that are not available:

Create the correct integration architecture/adapter.

Do not invent fake production APIs.

Do not claim an integration is production-ready if credentials or official API access are missing.

Clearly identify the configuration needed.

==================================================
78. IMPORTANT PAYMENT RULE
==================================================

Before activating production payment functionality, verify:

- current official payment provider requirements
- merchant account requirements
- API requirements
- supported currencies
- payment permissions
- legal/platform restrictions
- webhook/polling requirements

Do not invent payment API endpoints.

Do not bypass payment-provider restrictions.

Use official documentation for the final integration.

==================================================
79. IMPORTANT SMM RULE
==================================================

Do not hardcode one SMM provider into the whole application.

Use an adapter/provider interface.

This must allow the admin/developer to change providers later without rewriting the entire application.

Provider credentials must remain server-side.

==================================================
80. IMPORTANT BUSINESS RULE
==================================================

Normal store management must never require source-code editing.

Example:

I want to change:

Gemini 18 Month

$2.60

to:

$3.00

I should open:

Admin Dashboard
→ Products
→ Gemini 18 Month
→ Edit
→ Price
→ $3.00
→ Save

The customer Mini App automatically displays:

$3.00

No coding.

No redeployment.

==================================================
81. ADD PRODUCT BUSINESS RULE
==================================================

Example:

Admin wants to add:

Gemini 24 Month

Price:
$4.50

Type:
Digital Link

Category:
Digital Accounts

Admin:

Products
→ Add Product
→ Fill form
→ Create

The product immediately becomes available to customers.

No source-code changes.

==================================================
82. DISABLE PRODUCT BUSINESS RULE
==================================================

Example:

Admin wants to remove:

Gemini 18 Month

Admin clicks:

Disable

The product becomes:

DISABLED

It disappears from customer:

- Home
- Store
- Search
- Category
- Featured
- Popular

But historical orders remain.

==================================================
83. HISTORICAL ORDER RULE
==================================================

Never destroy historical order information simply because a product is disabled or archived.

Historical orders must preserve:

- product name
- product price
- quantity
- total
- currency
- order number
- purchase date
- delivery information where appropriate

==================================================
84. FINAL CUSTOMER FLOW
==================================================

Customer opens:

Telegram Bot

↓

/start

↓

[Open JR Digital license]

↓

Telegram Mini App opens

↓

Automatically identify Telegram account

↓

Show:

Profile photo
Name
Username
Balance

↓

Customer searches/browses products

↓

Selects product

↓

Views price

↓

Clicks Buy

↓

Creates order

↓

Selects payment:

KHQR

or

Wallet Balance

↓

Payment is verified by backend

↓

Order becomes PAID

↓

Digital product automatically delivered privately

↓

Customer receives:

Order number
Product
Delivery
Instructions

↓

Telegram group receives:

NEW ORDER
Order number
Product
Amount
Payment confirmed

WITHOUT private customer/product credentials.

==================================================
85. FINAL ADMIN FLOW
==================================================

Admin opens Admin Dashboard.

↓

Products

↓

Can:

Add
Edit
Duplicate
Disable
Archive
Change Price
Change Stock
Change Category
Change Image
Change Description
Change Instructions

↓

Changes are saved to database.

↓

Customer Mini App automatically uses the new information.

No source code changes.

==================================================
86. FINAL SYSTEM GOAL
==================================================

The final application must be:

JR Digital license

A professional Telegram Bot + Telegram Mini App + Digital Store + SMM platform.

Customer:

Open Telegram
↓
Open Mini App
↓
Automatically authenticated
↓
Browse
↓
Search
↓
Purchase
↓
Pay
↓
Payment verified
↓
Automatic delivery
↓
Order completed

Admin:

Open Admin Dashboard
↓
Manage products
↓
Change prices
↓
Add products
↓
Disable products
↓
Manage stock
↓
Manage orders
↓
Manage payments
↓
Manage wallet
↓
Manage SMM services
↓
View analytics
↓
Manage support

The application must be database-driven, secure, scalable, responsive, maintainable, and production-ready.

The administrator must be able to operate normal day-to-day store management without editing source code.

==================================================
87. FIRST ACTION FOR CODEX
==================================================

When starting this project, DO NOT immediately write the entire application.

First:

1. Read this AGENTS.md completely.
2. Inspect the workspace.
3. Determine that the workspace is empty or identify existing files.
4. Create a detailed implementation plan.
5. Explain the proposed architecture.
6. Identify required dependencies.
7. Identify required environment variables.
8. Identify which external credentials will be required later.
9. Identify anything that cannot be safely implemented without official API documentation or credentials.

Do NOT start the full implementation until the current development stage has been approved.

==================================================
88. FIRST DEVELOPMENT STAGE
==================================================

After the implementation plan is approved, start with Stage 1 only.

Stage 1 should establish:

- project structure
- TypeScript
- package management
- monorepo structure
- shared package
- API foundation
- bot foundation
- Mini App foundation
- environment configuration
- PostgreSQL/Prisma foundation
- Redis foundation
- linting
- formatting
- testing foundation
- Docker Compose for local dependencies
- README foundation

After Stage 1:

1. Run type checking.
2. Run linting.
3. Run tests.
4. Fix errors.
5. Confirm the project can start locally.
6. Stop and report what was completed.

Do not skip to later stages without approval.