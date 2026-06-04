function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseIntCsv(value) {
  return parseCsv(value)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

export const DEFAULT_CATEGORIES = [
  "JavaScript",
  "TypeScript",
  "Python",
  "Java",
  "C",
  "C++",
  "C#",
  "PHP",
  "Ruby",
  "Go",
  "Rust",
  "Swift",
  "Kotlin",
  "Dart",
  "HTML",
  "CSS",
  "SQL",
  "Shell/Bash",
  "Lua",
  "R",
  "MATLAB",
  "Solidity",
  "Web3",
  "DevOps",
  "Databases",
  "Frameworks",
  "Tools",
  "Ebooks",
  "Courses",
  "Templates",
  "Other",
];

export const cfg = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  MONGODB_URI: process.env.MONGODB_URI || "",
  STORAGE_CHANNEL_ID: process.env.STORAGE_CHANNEL_ID || "",
  BOT_ADMIN_IDS_RAW: process.env.BOT_ADMIN_IDS || "",
  BOT_ADMIN_IDS: parseIntCsv(process.env.BOT_ADMIN_IDS || ""),
  VIP_CONTACT_TEXT: process.env.VIP_CONTACT_TEXT || "",
  DEFAULT_VIP_DAYS: Number(process.env.DEFAULT_VIP_DAYS || 30),
  SPONSOR_CHAT_IDS: parseCsv(process.env.SPONSOR_CHAT_IDS || ""),
  SPONSOR_JOIN_URLS: parseCsv(process.env.SPONSOR_JOIN_URLS || ""),
  VIP_EXPIRY_CHECK_MS: Number(process.env.VIP_EXPIRY_CHECK_MS || 300000),
};

export function isAdminId(userId) {
  if (!userId) return false;
  return cfg.BOT_ADMIN_IDS.includes(Number(userId));
}

export function vipContactText(userId) {
  if (cfg.VIP_CONTACT_TEXT.trim()) return cfg.VIP_CONTACT_TEXT.trim();
  return "To request VIP access, message an admin and include your Telegram user ID: " + String(userId || "unknown") + ".";
}
