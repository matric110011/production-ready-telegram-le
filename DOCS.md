Code Vault is a Telegram bot for sharing programming learning resources through inline menus.

It stores original files, links, text posts, and media in a private Telegram storage channel. MongoDB stores searchable metadata, users, VIP subscriptions, tasks, submissions, activity events, and stats.

Public commands:

1) /start
Opens Code Vault, registers or refreshes the user, records a visit, checks sponsor membership when configured, and shows the inline main menu.

2) /help
Explains how to browse free files, request VIP access, submit tasks, and use the admin contact flow.

Main menu buttons:

1) Browse Files
Shows programming languages and categories with inline buttons. The default categories include JavaScript, TypeScript, Python, Java, C, C++, C#, PHP, Ruby, Go, Rust, Swift, Kotlin, Dart, HTML, CSS, SQL, Shell/Bash, Lua, R, MATLAB, Solidity, Web3, DevOps, Databases, Frameworks, Tools, Ebooks, Courses, Templates, and Other.

2) Search
Lets users search resource titles, descriptions, tags, and categories.

3) Free Files
Shows free resources available to all registered users.

4) VIP Files
Shows VIP resources. Free users can view metadata but cannot receive the stored file until VIP is active.

5) My VIP Status
Shows whether the user is Free or VIP. VIP users see expiry date and remaining time. Free users see VIP instructions and their Telegram user ID.

6) Tasks
Shows active tasks created by admins. Users can submit proof as text, file, image, media, or link.

7) Help
Shows usage instructions.

8) Admin Panel
Visible only to admins configured in BOT_ADMIN_IDS.

Admin panel sections:

1) Upload Resource
Starts an upload wizard. The admin sends a file, media, link, or text post. The bot asks for title, description, category/language, tags, Free or VIP tier, and confirmation. After confirmation, the bot copies the content to STORAGE_CHANNEL_ID and stores metadata in MongoDB.

2) Manage Resources
Lists recent resources and allows admins to hide or delete records.

3) VIP Users
Admins can add, extend, inspect, list, and remove VIP users by Telegram user ID. Durations include 7 days, 30 days, 90 days, lifetime, and custom days.

4) Tasks
Admins can create active tasks and review pending submissions. Approval can grant VIP days when the task has a VIP reward.

5) Stats
Shows total users, active users daily/weekly/monthly, visits, deliveries, failed deliveries, total resources, resources by tier, resources by category, active/expired VIP users, task counts, and task submission counts.

6) Settings/Help
Shows runtime configuration guidance.

Private storage channel setup:

1) Create a private Telegram channel.

2) Add the bot as an admin in that channel.

3) Give the bot permission to post messages.

4) Get the channel ID. Private channel IDs usually look like -1001234567890.

5) Set STORAGE_CHANNEL_ID to that ID.

6) Do not add the storage channel to sponsor requirements. It is only for private content storage.

Admin setup:

1) Get your Telegram numeric user ID.

2) Set BOT_ADMIN_IDS to a comma-separated list, for example 11111111,22222222.

3) If BOT_ADMIN_IDS is empty, the bot still starts, logs a warning, and hides admin features.

VIP behavior:

Free users can receive free resources.

VIP resources require an active VIP subscription. VIP is checked when opening VIP areas and again immediately before delivery.

Expired subscriptions are marked expired by an in-process scheduled loop. Lifetime VIP subscriptions do not expire automatically.

If VIP_CONTACT_TEXT is not configured, the bot falls back to a generic instruction asking the user to message an admin with their Telegram user ID.

Sponsor join gate:

If SPONSOR_CHAT_IDS is configured, non-admin users must be members of those channels/groups before accessing menus. This should include sponsor or backup groups/channels only, never the private storage channel.

Use SPONSOR_JOIN_URLS to show join buttons. The bot checks membership with Telegram getChatMember.

MongoDB collections:

1) users
Stores Telegram user profile, first seen, last active, visit count, and download count.

2) resources
Stores title, description, category, tags, tier, storage channel ID, storage message ID, status, views, downloads, and failed delivery count.

3) vipSubscriptions
Stores Telegram user ID, status, start date, expiry date, lifetime flag, grantedBy admin ID, duration, and notes.

4) tasks
Stores task title, instructions, reward type, VIP reward days, status, and creator admin.

5) taskSubmissions
Stores task ID, user ID, submitted message ID/text, review status, reviewer, review note, and timestamps.

6) activityEvents
Stores visits, menu opens, searches, file views, delivery success/failure, task views, and submissions.

7) categories
Stores configurable programming languages/categories.

Environment variables:

1) TELEGRAM_BOT_TOKEN
Required. Bot token from BotFather.

2) MONGODB_URI
Required for full operation. Used for users, catalog, VIPs, tasks, and stats.

3) STORAGE_CHANNEL_ID
Required for uploads and file delivery. Must point to the private storage channel.

4) BOT_ADMIN_IDS
Required for admin features. Comma-separated numeric Telegram user IDs.

5) VIP_CONTACT_TEXT
Optional. Custom text shown to free users requesting VIP.

6) DEFAULT_VIP_DAYS
Optional. Defaults to 30.

7) SPONSOR_CHAT_IDS
Optional. Comma-separated sponsor chat IDs users must join before access.

8) SPONSOR_JOIN_URLS
Optional. Comma-separated invite/public URLs used as join buttons.

9) VIP_EXPIRY_CHECK_MS
Optional. Defaults to 300000.

Run locally:

1) Install dependencies with npm install.

2) Copy .env.sample to .env.

3) Fill TELEGRAM_BOT_TOKEN, MONGODB_URI, STORAGE_CHANNEL_ID, and BOT_ADMIN_IDS.

4) Run npm run dev.

Deploy as one Node.js service:

1) Set the same environment variables in your hosting panel.

2) Build command: npm run build.

3) Start command: npm start.

4) The bot uses long polling and clears webhooks before polling.

Diagnostics:

The bot logs boot env sanity using booleans only. It never logs secrets.

It logs MongoDB connection failures, storage channel copy operations, upload start/success/failure, delivery start/success/failure, fallback attempts, polling failures, VIP expiry loop cycles, and memory usage once per minute.
