import { InlineKeyboard } from "grammy";
import { cfg, isAdminId, vipContactText } from "../lib/config.js";
import { log, safeErr } from "../lib/log.js";
import {
  PAGE_SIZE,
  createResource,
  createTask,
  ensureCategory,
  getResource,
  getStats,
  getTask,
  getVipStatus,
  grantVip,
  incrementResource,
  listCategories,
  listResources,
  listSubmissions,
  listTasks,
  listVip,
  markUserActive,
  recordEvent,
  removeVip,
  reviewSubmission,
  setResourceStatus,
  submitTask,
} from "../services/store.js";

const state = new Map();

function setState(userId, value) {
  if (!userId) return;
  if (state.size > 1000) state.clear();
  state.set(String(userId), value);
}

function getState(userId) {
  return state.get(String(userId));
}

function clearState(userId) {
  state.delete(String(userId));
}

function isAdmin(ctx) {
  return isAdminId(ctx.from?.id);
}

function mainMenu(isAdminUser = false) {
  const kb = new InlineKeyboard()
    .text("Browse Files", "m:browse:0").text("Search", "m:search").row()
    .text("Free Files", "m:list:free:0").text("VIP Files", "m:list:vip:0").row()
    .text("My VIP Status", "m:vipstatus").text("Tasks", "m:tasks").row()
    .text("Help", "m:help");
  if (isAdminUser) kb.row().text("Admin Panel", "a:panel");
  return kb;
}

function backMenu() {
  return new InlineKeyboard().text("Back To Menu", "m:home");
}

function adminMenu() {
  return new InlineKeyboard()
    .text("Upload Resource", "a:upload").text("Manage Resources", "a:manage:0").row()
    .text("VIP Users", "a:vip").text("Tasks", "a:tasks").row()
    .text("Stats", "a:stats").text("Settings/Help", "a:settings").row()
    .text("Back", "m:home");
}

function resourceText(resource) {
  const tags = Array.isArray(resource.tags) && resource.tags.length ? resource.tags.join(", ") : "none";
  const desc = String(resource.description || "No description").slice(0, 350);
  return [
    resource.title,
    "Category: " + resource.category,
    "Tier: " + resource.accessTier.toUpperCase(),
    "Tags: " + tags,
    "",
    desc,
  ].join("\n");
}

function fmtDate(d) {
  if (!d) return "never";
  return new Date(d).toISOString().slice(0, 10);
}

function countdown(d) {
  if (!d) return "Lifetime";
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return days + " days, " + hours + " hours";
}

async function safeEditOrReply(ctx, text, keyboard) {
  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, { reply_markup: keyboard });
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  } catch {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

async function checkSponsors(ctx) {
  if (isAdmin(ctx)) return true;
  if (!cfg.SPONSOR_CHAT_IDS.length) return true;
  for (const chatId of cfg.SPONSOR_CHAT_IDS) {
    try {
      const member = await ctx.api.getChatMember(chatId, ctx.from.id);
      if (["left", "kicked"].includes(member.status)) return false;
    } catch (err) {
      log.warn("Sponsor membership check failed", { operation: "getChatMember", err: safeErr(err) });
      return false;
    }
  }
  return true;
}

async function showSponsorGate(ctx) {
  const kb = new InlineKeyboard();
  cfg.SPONSOR_JOIN_URLS.forEach((url, i) => kb.url("Join Sponsor " + (i + 1), url).row());
  kb.text("I Joined, Check Again", "m:home");
  await safeEditOrReply(ctx, "Please join the required sponsor channel/group first. The storage channel is private and is never used as a join requirement.", kb);
}

async function requireAccess(ctx) {
  await markUserActive(ctx.from);
  const ok = await checkSponsors(ctx);
  if (!ok) {
    await showSponsorGate(ctx);
    return false;
  }
  return true;
}

export async function showHome(ctx) {
  await recordEvent("menu_open", ctx, { menu: "home" });
  if (!(await requireAccess(ctx))) return;
  await safeEditOrReply(ctx, "Welcome to Code Vault. Browse programming files, search learning resources, check VIP status, or complete tasks.", mainMenu(isAdmin(ctx)));
}

export async function showHelp(ctx) {
  await recordEvent("help_open", ctx, {});
  const text = [
    "Code Vault help",
    "",
    "Browse free files from the main menu, choose a category, open a resource card, then press Get File.",
    "VIP files show their metadata to everyone, but delivery is only available to users with active VIP access.",
    "To request VIP, open My VIP Status and send your Telegram user ID to an admin.",
    "Tasks can be opened from the Tasks button. Submit proof as text, link, photo, media, or file. Admins review submissions with inline buttons.",
    "All navigation uses inline buttons. No reply keyboards are used.",
  ].join("\n");
  await safeEditOrReply(ctx, text, new InlineKeyboard().text("Browse Free Files", "m:list:free:0").text("VIP Status", "m:vipstatus").row().text("Tasks", "m:tasks").text("Back", "m:home"));
}

async function showCategories(ctx, page = 0) {
  if (!(await requireAccess(ctx))) return;
  await recordEvent("category_open", ctx, { page });
  const { rows, total } = await listCategories(page);
  const kb = new InlineKeyboard();
  rows.forEach((cat) => kb.text(cat.name, "m:cat:" + cat.slug + ":0").row());
  if (page > 0) kb.text("Previous", "m:browse:" + (page - 1));
  if ((page + 1) * PAGE_SIZE < total) kb.text("Next", "m:browse:" + (page + 1));
  kb.row().text("Back", "m:home");
  await safeEditOrReply(ctx, "Choose a programming language or category.", kb);
}

async function showResourceList(ctx, opts = {}) {
  if (!(await requireAccess(ctx))) return;
  const page = Number(opts.page || 0);
  const { rows, total } = await listResources(opts);
  const kb = new InlineKeyboard();
  rows.forEach((r) => kb.text((r.accessTier === "vip" ? "VIP " : "Free ") + r.title.slice(0, 34), "m:item:" + String(r._id)).row());
  if (page > 0) kb.text("Previous", opts.backPrefix + (page - 1));
  if ((page + 1) * PAGE_SIZE < total) kb.text("Next", opts.backPrefix + (page + 1));
  kb.row().text("Back", opts.backTo || "m:home");
  const title = total ? "Resources found: " + total : "No resources found yet.";
  await safeEditOrReply(ctx, title, kb);
}

async function showResource(ctx, id) {
  if (!(await requireAccess(ctx))) return;
  const resource = await getResource(id);
  if (!resource) return safeEditOrReply(ctx, "Resource not found.", backMenu());
  await incrementResource(id, "viewCount");
  await recordEvent("file_view", ctx, { resourceId: id, tier: resource.accessTier });
  const kb = new InlineKeyboard().text("Get File", "m:get:" + id).row().text("Back", "m:home");
  await safeEditOrReply(ctx, resourceText(resource), kb);
}

async function deliverResource(ctx, id) {
  if (!(await requireAccess(ctx))) return;
  const resource = await getResource(id);
  if (!resource) return ctx.answerCallbackQuery({ text: "Resource not found." });
  if (resource.accessTier === "vip") {
    const vip = await getVipStatus(ctx.from.id);
    if (!vip.active) {
      await recordEvent("vip_denied", ctx, { resourceId: id });
      return safeEditOrReply(ctx, "This is a VIP resource. " + vipContactText(ctx.from.id), new InlineKeyboard().text("My VIP Status", "m:vipstatus").text("Back", "m:home"));
    }
  }
  log.info("File delivery start", { resourceId: id, userId: String(ctx.from.id) });
  try {
    await ctx.api.copyMessage(ctx.chat.id, resource.storageChatId, resource.storageMessageId);
    await incrementResource(id, "downloadCount");
    await recordEvent("delivery_success", ctx, { resourceId: id });
    log.info("File delivery success", { resourceId: id });
  } catch (copyErr) {
    log.warn("File copy failed; trying forward fallback", { resourceId: id, err: safeErr(copyErr) });
    try {
      await ctx.api.forwardMessage(ctx.chat.id, resource.storageChatId, resource.storageMessageId);
      await incrementResource(id, "downloadCount");
      await recordEvent("delivery_success", ctx, { resourceId: id, fallback: "forward" });
      log.info("File delivery fallback success", { resourceId: id });
    } catch (forwardErr) {
      await incrementResource(id, "failedDeliveryCount");
      await recordEvent("delivery_failed", ctx, { resourceId: id });
      log.error("File delivery failure", { resourceId: id, err: safeErr(forwardErr) });
      await ctx.reply("Sorry, I could not deliver this file right now. An admin can check the storage channel permissions.", { reply_markup: backMenu() });
    }
  }
}

async function showVipStatus(ctx) {
  if (!(await requireAccess(ctx))) return;
  await recordEvent("vip_status", ctx, {});
  const vip = await getVipStatus(ctx.from.id);
  if (vip.active) {
    const text = vip.subscription.isLifetime
      ? "Your status: VIP\nExpiry: Lifetime"
      : "Your status: VIP\nExpires: " + fmtDate(vip.subscription.expiresAt) + "\nTime left: " + countdown(vip.subscription.expiresAt);
    return safeEditOrReply(ctx, text, backMenu());
  }
  await safeEditOrReply(ctx, "Your status: Free\n" + vipContactText(ctx.from.id), backMenu());
}

async function showTasks(ctx) {
  if (!(await requireAccess(ctx))) return;
  await recordEvent("task_view", ctx, {});
  const rows = await listTasks("active");
  const kb = new InlineKeyboard();
  rows.forEach((task) => kb.text(task.title.slice(0, 35), "m:task:" + String(task._id)).row());
  kb.text("Back", "m:home");
  await safeEditOrReply(ctx, rows.length ? "Active tasks:" : "No active tasks right now.", kb);
}

async function showTask(ctx, id) {
  if (!(await requireAccess(ctx))) return;
  const task = await getTask(id);
  if (!task || task.status !== "active") return safeEditOrReply(ctx, "Task not found or inactive.", backMenu());
  const text = task.title + "\n\n" + task.instructions + "\n\nReward: " + (task.rewardVipDays ? task.rewardVipDays + " VIP days" : "Admin review");
  await safeEditOrReply(ctx, text, new InlineKeyboard().text("Submit Proof", "m:submit:" + id).row().text("Back", "m:tasks"));
}

async function showAdmin(ctx) {
  if (!isAdmin(ctx)) return ctx.answerCallbackQuery?.({ text: "Admins only." });
  await recordEvent("admin_panel", ctx, {});
  await safeEditOrReply(ctx, "Admin Panel", adminMenu());
}

async function showStats(ctx) {
  if (!isAdmin(ctx)) return;
  const s = await getStats();
  if (!s) return safeEditOrReply(ctx, "Stats are unavailable because MongoDB is not connected.", adminMenu());
  const cats = (s.byCategory || []).map((x) => String(x._id || "Other") + ": " + x.count).join("\n") || "none";
  const text = [
    "Stats",
    "Users: " + s.totalUsers,
    "Active daily: " + s.activeDaily,
    "Active weekly: " + s.activeWeekly,
    "Active monthly: " + s.activeMonthly,
    "Visits: " + s.totalVisits,
    "Deliveries: " + s.deliveries,
    "Failed deliveries: " + s.failedDeliveries,
    "Resources: " + s.totalResources + " total, " + s.freeResources + " free, " + s.vipResources + " VIP",
    "VIP: " + s.activeVip + " active, " + s.expiredVip + " expired",
    "Tasks: " + s.taskCount + ", pending submissions: " + s.pendingSubs + ", approved: " + s.approvedSubs,
    "",
    "Resources by category:",
    cats,
  ].join("\n");
  await safeEditOrReply(ctx, text, new InlineKeyboard().text("Back", "a:panel"));
}

async function startUpload(ctx) {
  if (!isAdmin(ctx)) return;
  if (!cfg.STORAGE_CHANNEL_ID) return safeEditOrReply(ctx, "STORAGE_CHANNEL_ID is not configured. Add the private channel ID first.", adminMenu());
  setState(ctx.from.id, { flow: "upload", step: "content" });
  log.info("Resource upload start", { adminId: String(ctx.from.id) });
  await safeEditOrReply(ctx, "Send the file, media, link, or text post to store.", new InlineKeyboard().text("Cancel", "a:cancel"));
}

async function uploadCategoryKeyboard(ctx) {
  const { rows } = await listCategories(0);
  const kb = new InlineKeyboard();
  rows.slice(0, 20).forEach((cat) => kb.text(cat.name, "a:upcat:" + cat.slug).row());
  kb.text("Other / Custom", "a:upcat:custom").row().text("Cancel", "a:cancel");
  await ctx.reply("Choose a category or custom tag.", { reply_markup: kb });
}

async function confirmUpload(ctx) {
  const st = getState(ctx.from.id);
  const tags = st.tags?.length ? st.tags.join(", ") : "none";
  const text = ["Confirm upload", "Title: " + st.title, "Category: " + st.category, "Tier: " + st.accessTier.toUpperCase(), "Tags: " + tags, "", st.description].join("\n");
  await ctx.reply(text, { reply_markup: new InlineKeyboard().text("Publish", "a:uppub").text("Cancel", "a:cancel") });
}

async function publishUpload(ctx) {
  if (!isAdmin(ctx)) return;
  const st = getState(ctx.from.id);
  if (!st || st.flow !== "upload") return;
  try {
    log.info("Storage channel copy start", { adminId: String(ctx.from.id), storageConfigured: !!cfg.STORAGE_CHANNEL_ID });
    const copied = await ctx.api.copyMessage(cfg.STORAGE_CHANNEL_ID, st.fromChatId, st.messageId);
    await ensureCategory(st.category, ctx.from.id);
    const resource = await createResource({
      title: st.title,
      description: st.description,
      category: st.category,
      tags: st.tags,
      accessTier: st.accessTier,
      storageChatId: cfg.STORAGE_CHANNEL_ID,
      storageMessageId: copied.message_id,
      contentType: st.contentType,
      uploadedByAdminId: ctx.from.id,
    });
    clearState(ctx.from.id);
    await recordEvent("admin_upload_published", ctx, { resourceId: String(resource?._id || "") });
    log.info("Resource upload success", { resourceId: String(resource?._id || "") });
    await safeEditOrReply(ctx, "Resource published successfully.", new InlineKeyboard().text("Upload Another", "a:upload").text("Admin Panel", "a:panel"));
  } catch (err) {
    log.error("Resource upload failure", { operation: "copyMessage", err: safeErr(err) });
    await ctx.reply("Upload failed. Check that the bot is an admin in the private storage channel.", { reply_markup: adminMenu() });
  }
}

async function showVipAdmin(ctx) {
  if (!isAdmin(ctx)) return;
  await safeEditOrReply(ctx, "VIP Users", new InlineKeyboard().text("Add/Extend VIP", "a:vipadd").text("Remove VIP", "a:vipremove").row().text("Active VIP", "a:viplist:active").text("Expired VIP", "a:viplist:expired").row().text("Inspect User", "a:vipinspect").text("Back", "a:panel"));
}

async function durationKeyboard(prefix) {
  return new InlineKeyboard()
    .text("7 days", prefix + ":7").text("30 days", prefix + ":30").row()
    .text("90 days", prefix + ":90").text("Lifetime", prefix + ":life").row()
    .text("Custom days", prefix + ":custom").text("Cancel", "a:cancel");
}

async function showVipList(ctx, status) {
  const rows = await listVip(status, 15);
  const text = rows.length ? rows.map((r) => r.telegramUserId + " until " + (r.isLifetime ? "Lifetime" : fmtDate(r.expiresAt))).join("\n") : "No " + status + " VIP users.";
  await safeEditOrReply(ctx, text, new InlineKeyboard().text("Back", "a:vip"));
}

async function showAdminTasks(ctx) {
  if (!isAdmin(ctx)) return;
  const pending = await listSubmissions("pending");
  const kb = new InlineKeyboard().text("Create Task", "a:taskcreate").row();
  pending.slice(0, 10).forEach((s) => kb.text("Review " + s.telegramUserId, "a:sub:" + String(s._id)).row());
  kb.text("Back", "a:panel");
  await safeEditOrReply(ctx, pending.length ? "Pending submissions:" : "No pending submissions.", kb);
}

async function showManage(ctx, page = 0) {
  if (!isAdmin(ctx)) return;
  const { rows, total } = await listResources({ page });
  const kb = new InlineKeyboard();
  rows.forEach((r) => kb.text(r.title.slice(0, 35), "a:res:" + String(r._id)).row());
  if (page > 0) kb.text("Previous", "a:manage:" + (page - 1));
  if ((page + 1) * PAGE_SIZE < total) kb.text("Next", "a:manage:" + (page + 1));
  kb.row().text("Back", "a:panel");
  await safeEditOrReply(ctx, total ? "Manage resources:" : "No resources yet.", kb);
}

async function handleCallback(ctx) {
  const data = ctx.callbackQuery.data || "";
  await ctx.answerCallbackQuery().catch(() => {});

  if (data === "m:home") return showHome(ctx);
  if (data === "m:help") return showHelp(ctx);
  if (data.startsWith("m:browse:")) return showCategories(ctx, Number(data.split(":")[2] || 0));
  if (data.startsWith("m:cat:")) {
    const [, , slug, page] = data.split(":");
    return showResourceList(ctx, { categorySlug: slug, page: Number(page || 0), backPrefix: "m:cat:" + slug + ":", backTo: "m:browse:0" });
  }
  if (data.startsWith("m:list:")) {
    const [, , tier, page] = data.split(":");
    return showResourceList(ctx, { tier, page: Number(page || 0), backPrefix: "m:list:" + tier + ":", backTo: "m:home" });
  }
  if (data === "m:search") {
    setState(ctx.from.id, { flow: "search" });
    return safeEditOrReply(ctx, "Send a keyword to search titles, descriptions, tags, and categories.", new InlineKeyboard().text("Cancel", "m:home"));
  }
  if (data.startsWith("m:item:")) return showResource(ctx, data.split(":")[2]);
  if (data.startsWith("m:get:")) return deliverResource(ctx, data.split(":")[2]);
  if (data === "m:vipstatus") return showVipStatus(ctx);
  if (data === "m:tasks") return showTasks(ctx);
  if (data.startsWith("m:task:")) return showTask(ctx, data.split(":")[2]);
  if (data.startsWith("m:submit:")) {
    setState(ctx.from.id, { flow: "task_submit", taskId: data.split(":")[2] });
    return safeEditOrReply(ctx, "Send your task proof now. It can be text, a link, photo, media, or file.", new InlineKeyboard().text("Cancel", "m:tasks"));
  }

  if (data === "a:panel") return showAdmin(ctx);
  if (!isAdmin(ctx)) return;
  if (data === "a:cancel") { clearState(ctx.from.id); return showAdmin(ctx); }
  if (data === "a:upload") return startUpload(ctx);
  if (data.startsWith("a:upcat:")) {
    const st = getState(ctx.from.id);
    if (!st) return;
    const slug = data.split(":")[2];
    if (slug === "custom") {
      st.step = "customCategory";
      setState(ctx.from.id, st);
      return ctx.reply("Send the custom category or language name.");
    }
    const cats = await listCategories(0);
    const found = cats.rows.find((c) => c.slug === slug);
    st.category = found?.name || slug;
    st.step = "tags";
    setState(ctx.from.id, st);
    return ctx.reply("Send additional tags separated by commas, or type none.");
  }
  if (data.startsWith("a:uptier:")) {
    const st = getState(ctx.from.id);
    if (!st) return;
    st.accessTier = data.split(":")[2] === "vip" ? "vip" : "free";
    st.step = "confirm";
    setState(ctx.from.id, st);
    return confirmUpload(ctx);
  }
  if (data === "a:uppub") return publishUpload(ctx);
  if (data.startsWith("a:manage:")) return showManage(ctx, Number(data.split(":")[2] || 0));
  if (data.startsWith("a:res:")) {
    const id = data.split(":")[2];
    const r = await getResource(id);
    if (!r) return;
    return safeEditOrReply(ctx, resourceText(r), new InlineKeyboard().text("Hide", "a:hide:" + id).text("Delete", "a:del:" + id).row().text("Back", "a:manage:0"));
  }
  if (data.startsWith("a:hide:")) { await setResourceStatus(data.split(":")[2], "hidden"); return showManage(ctx, 0); }
  if (data.startsWith("a:del:")) { await setResourceStatus(data.split(":")[2], "deleted"); return showManage(ctx, 0); }
  if (data === "a:vip") return showVipAdmin(ctx);
  if (data === "a:vipadd") { setState(ctx.from.id, { flow: "vip_add", step: "user" }); return ctx.reply("Send the Telegram user ID to add or extend VIP."); }
  if (data === "a:vipremove") { setState(ctx.from.id, { flow: "vip_remove" }); return ctx.reply("Send the Telegram user ID to remove from VIP."); }
  if (data === "a:vipinspect") { setState(ctx.from.id, { flow: "vip_inspect" }); return ctx.reply("Send the Telegram user ID to inspect."); }
  if (data.startsWith("a:viplist:")) return showVipList(ctx, data.split(":")[2]);
  if (data.startsWith("a:vipdur:")) {
    const st = getState(ctx.from.id);
    if (!st) return;
    const value = data.split(":")[2];
    if (value === "custom") { st.step = "customDays"; setState(ctx.from.id, st); return ctx.reply("Send the number of VIP days."); }
    const sub = await grantVip({ telegramUserId: st.telegramUserId, days: Number(value), isLifetime: value === "life", grantedByAdminId: ctx.from.id });
    clearState(ctx.from.id);
    if (sub) await ctx.api.sendMessage(st.telegramUserId, "Your Code Vault VIP access is active.").catch(() => {});
    return safeEditOrReply(ctx, sub ? "VIP access saved." : "Could not save VIP access.", new InlineKeyboard().text("Back", "a:vip"));
  }
  if (data === "a:tasks") return showAdminTasks(ctx);
  if (data === "a:taskcreate") { setState(ctx.from.id, { flow: "task_create", step: "title" }); return ctx.reply("Send the task title."); }
  if (data.startsWith("a:taskreward:")) {
    const st = getState(ctx.from.id);
    if (!st) return;
    const days = Number(data.split(":")[2] || 0);
    const task = await createTask({ title: st.title, instructions: st.instructions, rewardVipDays: days, createdByAdminId: ctx.from.id });
    clearState(ctx.from.id);
    return safeEditOrReply(ctx, task ? "Task created." : "Could not create task.", new InlineKeyboard().text("Back", "a:tasks"));
  }
  if (data.startsWith("a:sub:")) {
    const id = data.split(":")[2];
    return safeEditOrReply(ctx, "Review submission " + id, new InlineKeyboard().text("Approve", "a:approve:" + id).text("Reject", "a:reject:" + id).row().text("Back", "a:tasks"));
  }
  if (data.startsWith("a:approve:")) {
    const sub = await reviewSubmission(data.split(":")[2], "approved", ctx.from.id);
    if (sub) {
      const task = await getTask(String(sub.taskId));
      if (task?.rewardVipDays) await grantVip({ telegramUserId: sub.telegramUserId, days: task.rewardVipDays, grantedByAdminId: ctx.from.id, note: "Task reward" });
      await ctx.api.sendMessage(sub.telegramUserId, "Your task submission was approved.").catch(() => {});
    }
    return showAdminTasks(ctx);
  }
  if (data.startsWith("a:reject:")) {
    setState(ctx.from.id, { flow: "reject_reason", submissionId: data.split(":")[2] });
    return ctx.reply("Send an optional rejection reason, or type none.");
  }
  if (data === "a:stats") return showStats(ctx);
  if (data === "a:settings") return safeEditOrReply(ctx, "Settings help: configure TELEGRAM_BOT_TOKEN, MONGODB_URI, STORAGE_CHANNEL_ID, BOT_ADMIN_IDS, optional VIP_CONTACT_TEXT, DEFAULT_VIP_DAYS, SPONSOR_CHAT_IDS, and SPONSOR_JOIN_URLS.", adminMenu());
}

async function handleWizardMessage(ctx, next) {
  if (ctx.message?.text?.startsWith("/")) return next();
  const st = getState(ctx.from?.id);
  if (!st) return next();

  if (st.flow === "search") {
    clearState(ctx.from.id);
    await recordEvent("search", ctx, { query: ctx.message.text || "" });
    return showResourceList(ctx, { search: ctx.message.text || "", page: 0, backPrefix: "m:searchpage:", backTo: "m:home" });
  }

  if (st.flow === "task_submit") {
    const sub = await submitTask({ taskId: st.taskId, telegramUserId: ctx.from.id, messageId: ctx.message.message_id, text: ctx.message.text || ctx.message.caption || "" });
    clearState(ctx.from.id);
    await recordEvent("task_submission", ctx, { taskId: st.taskId });
    for (const adminId of cfg.BOT_ADMIN_IDS) {
      await ctx.api.sendMessage(adminId, "New task submission from " + ctx.from.id, { reply_markup: new InlineKeyboard().text("Review", "a:sub:" + String(sub?._id || "")) }).catch(() => {});
    }
    return ctx.reply("Submission received. An admin will review it.", { reply_markup: backMenu() });
  }

  if (st.flow === "upload" && isAdmin(ctx)) {
    if (st.step === "content") {
      st.fromChatId = ctx.chat.id;
      st.messageId = ctx.message.message_id;
      st.contentType = ctx.message.document ? "document" : ctx.message.photo ? "photo" : ctx.message.video ? "video" : ctx.message.text ? "text" : "message";
      st.step = "title";
      setState(ctx.from.id, st);
      return ctx.reply("Send a clear title for this resource.");
    }
    if (st.step === "title") { st.title = ctx.message.text || "Untitled"; st.step = "description"; setState(ctx.from.id, st); return ctx.reply("Send a short description."); }
    if (st.step === "description") { st.description = ctx.message.text || ""; st.step = "category"; setState(ctx.from.id, st); return uploadCategoryKeyboard(ctx); }
    if (st.step === "customCategory") { st.category = ctx.message.text || "Other"; st.step = "tags"; setState(ctx.from.id, st); return ctx.reply("Send additional tags separated by commas, or type none."); }
    if (st.step === "tags") {
      const raw = ctx.message.text || "";
      st.tags = raw.toLowerCase() === "none" ? [] : raw.split(",").map((x) => x.trim()).filter(Boolean);
      st.step = "tier";
      setState(ctx.from.id, st);
      return ctx.reply("Choose access tier.", { reply_markup: new InlineKeyboard().text("Free", "a:uptier:free").text("VIP", "a:uptier:vip").row().text("Cancel", "a:cancel") });
    }
  }

  if (isAdmin(ctx) && st.flow === "vip_add" && st.step === "user") {
    st.telegramUserId = String(ctx.message.text || "").trim();
    st.step = "duration";
    setState(ctx.from.id, st);
    return ctx.reply("Choose subscription duration.", { reply_markup: await durationKeyboard("a:vipdur") });
  }
  if (isAdmin(ctx) && st.flow === "vip_add" && st.step === "customDays") {
    const days = Math.max(1, Number(ctx.message.text || cfg.DEFAULT_VIP_DAYS || 30));
    const sub = await grantVip({ telegramUserId: st.telegramUserId, days, grantedByAdminId: ctx.from.id });
    clearState(ctx.from.id);
    if (sub) await ctx.api.sendMessage(st.telegramUserId, "Your Code Vault VIP access is active.").catch(() => {});
    return ctx.reply(sub ? "VIP access saved." : "Could not save VIP access.", { reply_markup: new InlineKeyboard().text("Back", "a:vip") });
  }
  if (isAdmin(ctx) && st.flow === "vip_remove") {
    const ok = await removeVip(String(ctx.message.text || "").trim(), ctx.from.id);
    clearState(ctx.from.id);
    return ctx.reply(ok ? "VIP access removed." : "Could not remove VIP access.", { reply_markup: new InlineKeyboard().text("Back", "a:vip") });
  }
  if (isAdmin(ctx) && st.flow === "vip_inspect") {
    const uid = String(ctx.message.text || "").trim();
    const vip = await getVipStatus(uid);
    clearState(ctx.from.id);
    return ctx.reply("User " + uid + "\nVIP: " + (vip.active ? "active" : "not active") + (vip.subscription?.expiresAt ? "\nExpires: " + fmtDate(vip.subscription.expiresAt) : ""), { reply_markup: new InlineKeyboard().text("Back", "a:vip") });
  }
  if (isAdmin(ctx) && st.flow === "task_create") {
    if (st.step === "title") { st.title = ctx.message.text || "Task"; st.step = "instructions"; setState(ctx.from.id, st); return ctx.reply("Send the task instructions."); }
    if (st.step === "instructions") {
      st.instructions = ctx.message.text || "";
      setState(ctx.from.id, st);
      return ctx.reply("Choose VIP reward duration.", { reply_markup: new InlineKeyboard().text("No VIP", "a:taskreward:0").text("7 days", "a:taskreward:7").row().text("30 days", "a:taskreward:30").text("90 days", "a:taskreward:90") });
    }
  }
  if (isAdmin(ctx) && st.flow === "reject_reason") {
    const note = (ctx.message.text || "").toLowerCase() === "none" ? "" : ctx.message.text || "";
    const sub = await reviewSubmission(st.submissionId, "rejected", ctx.from.id, note);
    clearState(ctx.from.id);
    if (sub) await ctx.api.sendMessage(sub.telegramUserId, "Your task submission was rejected." + (note ? " Reason: " + note : "")).catch(() => {});
    return ctx.reply("Submission rejected.", { reply_markup: new InlineKeyboard().text("Back", "a:tasks") });
  }

  return next();
}

export function registerLibrary(bot) {
  bot.callbackQuery(/^(m|a):/, handleCallback);
  bot.on("message", handleWizardMessage);
}
