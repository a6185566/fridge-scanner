// --- 1. 設定區 ---
// 從 Apps Script 指令碼屬性讀取 Line Channel Access Token，避免將 Secret 寫入程式碼。
const CHANNEL_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty('CHANNEL_ACCESS_TOKEN');
const SPREADSHEET_ID = '1yy0OSNl1GDyv9w71BPmUlb3LCIN11vSMU9NGAFmBocQ';
const SHEET_NAME = '工作表1'; 
const PRODUCT_DB_SHEET = '商品清單'; 

// --- 2. 網頁入口 (API 中心：供 GitHub 網頁呼叫) ---
function doGet(e) {
  const action = e.parameter.action;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  
  // A. 取得庫存清單 (包含第 6 欄輸入者資訊)
  if (action === 'getInventory') {
    const data = sheet.getDataRange().getValues();
    const inventory = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][1]) {
        inventory.push({
          id: i + 1,
          addDate: Utilities.formatDate(new Date(data[i][0]), "GMT+8", "yyyy/MM/dd"),
          name: String(data[i][1]),
          expDate: Utilities.formatDate(new Date(data[i][2]), "GMT+8", "yyyy/MM/dd"),
          count: parseInt(data[i][3]) || 1,
          user: String(data[i][5] || "系統") 
        });
      }
    }
    return createJsonResponse(inventory);
  }

  // B. 數量控制
  if (action === 'updateQty') {
    const row = parseInt(e.parameter.row);
    const mode = e.parameter.mode;
    if (row > 1) {
      if (mode === 'set') {
        const val = parseInt(e.parameter.val);
        if (val > 0) {
          sheet.getRange(row, 4).setValue(val);
        } else {
          sheet.deleteRow(row);
        }
      } else if (mode === 'plus') {
        let currentQty = parseInt(sheet.getRange(row, 4).getValue()) || 1;
        sheet.getRange(row, 4).setValue(currentQty + 1);
      } else if (mode === 'minus') {
        let currentQty = parseInt(sheet.getRange(row, 4).getValue()) || 1;
        if (currentQty > 1) {
          sheet.getRange(row, 4).setValue(currentQty - 1);
        } else {
          sheet.deleteRow(row);
        }
      }
      return createJsonResponse({ success: true });
    }
  }

  // C. 直接刪除
  if (action === 'delete') {
    const row = parseInt(e.parameter.row);
    if (row > 1) {
      sheet.deleteRow(row);
      return createJsonResponse({ success: true });
    }
  }

  // D. 搜尋品名 (雙層搜尋：個人庫 > OpenFoodFacts)
  if (action === 'search') {
    const barcode = e.parameter.barcode;
    let name = lookupProduct(barcode);
    if (!name) name = fetchFromOpenFoodFacts(barcode);
    return createJsonResponse({ success: !!name, name: name || "" });
  }
}

// --- 3. LINE 訊息入口 (處理進貨文字並發送 Flex Message) ---
function doPost(e) {
  const event = JSON.parse(e.postData.contents).events[0];
  const replyToken = event.replyToken;
  const userId = event.source.userId;
  
  // 獲取使用者名稱
  const userName = getUserDisplayName(userId);

  if (event.type === 'message' && event.message.type === 'text') {
    const userText = event.message.text;
    if (userText.includes("進貨成功！")) {
      const lines = userText.split('\n');
      const name = lines[1].split('：')[1];
      const count = lines[2].split('：')[1];
      const barcodeInfo = lines[3];
      const expDate = lines[4].split('：')[1];

      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_NAME);
      // 存入試算表：第 6 欄存入 userName
      sheet.appendRow([new Date(), name, expDate, count, barcodeInfo, userName]);

      const barcode = barcodeInfo.split('：')[1];
      if (barcode && barcode !== "手動輸入項目") updateProductDb(barcode, name);
      
      // 發送 Flex Message 卡片 (統一使用 🧑‍🍳 Emoji)
      sendFlexSuccessReply(replyToken, name, count, expDate, userName);
    }
  }
}

// --- 4. 每日定時廣播功能 ---
function dailyReminder() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const now = new Date().setHours(0, 0, 0, 0);
  const warningLimit = new Date();
  warningLimit.setDate(new Date().getDate() + 3);

  let expired = [];
  let warning = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i][1]) continue;
    const itemDate = new Date(data[i][2]);
    const info = { 
        name: String(data[i][1]), 
        qty: String(data[i][3]), 
        date: Utilities.formatDate(itemDate, "GMT+8", "MM/dd") 
    };
    if (itemDate < now) {
      expired.push(info);
    } else if (itemDate <= warningLimit) {
      warning.push(info);
    }
  }

  if (expired.length === 0 && warning.length === 0) return;

  const flexCard = createReminderFlexCard(expired, warning);
  broadcastFlexMessage(flexCard);
}

// --- 5. 工具與 API 函式 ---

function getUserDisplayName(userId) {
  try {
    const res = UrlFetchApp.fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
    });
    const profile = JSON.parse(res.getContentText());
    return profile.displayName || "神秘成員";
  } catch (e) {
    return "神秘成員";
  }
}

function sendFlexSuccessReply(replyToken, name, qty, exp, user) {
  const flexData = {
    "type": "bubble",
    "header": { "type": "box", "layout": "vertical", "contents": [{ "type": "text", "text": "📦 進貨成功", "weight": "bold", "color": "#FFFFFF", "size": "lg" }], "backgroundColor": "#00B900" },
    "body": { "type": "box", "layout": "vertical", "contents": [
      { "type": "text", "text": String(name), "weight": "bold", "size": "xl", "wrap": true },
      { "type": "separator", "margin": "md" },
      { "type": "box", "layout": "vertical", "margin": "md", "spacing": "sm", "contents": [
        { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [{ "type": "text", "text": "數量", "color": "#aaaaaa", "size": "sm", "flex": 1 }, { "type": "text", "text": String(qty) + " 個", "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }] },
        { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [{ "type": "text", "text": "效期", "color": "#aaaaaa", "size": "sm", "flex": 1 }, { "type": "text", "text": String(exp), "wrap": true, "color": "#ff4d4d", "size": "sm", "flex": 5, "weight": "bold" }] }
      ] }
    ] },
    "footer": { "type": "box", "layout": "vertical", "contents": [{ "type": "text", "text": "🧑‍🍳 輸入者：" + String(user), "size": "xs", "color": "#bbbbbb", "align": "end" }] }
  };

  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    method: 'post',
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: "flex", altText: "冰箱進貨通知", contents: flexData }]
    })
  });
}

function createReminderFlexCard(expired, warning) {
  let rows = [];
  if (expired.length > 0) {
    rows.push({ "type": "text", "text": "🔴 已過期", "weight": "bold", "color": "#ff4d4d", "margin": "md" });
    expired.forEach(i => { rows.push({ "type": "text", "text": `· ${i.name} x${i.qty} (${i.date})`, "size": "sm", "color": "#666666" }); });
  }
  if (warning.length > 0) {
    rows.push({ "type": "text", "text": "🟡 快過期", "weight": "bold", "color": "#b8860b", "margin": "md" });
    warning.forEach(i => { rows.push({ "type": "text", "text": `· ${i.name} x${i.qty} (${i.date})`, "size": "sm", "color": "#666666" }); });
  }

  return {
    "type": "bubble",
    "body": { "type": "box", "layout": "vertical", "contents": [
      { "type": "text", "text": "🍱 冰箱管家早報", "weight": "bold", "color": "#00B900", "size": "sm" },
      { "type": "text", "text": "庫存狀態提醒", "weight": "bold", "size": "xl", "margin": "md" },
      { "type": "separator", "margin": "md" },
      ...rows,
      { "type": "button", "action": { "type": "uri", "label": "查看冰箱", "uri": "https://liff.line.me/2009559112-ixFyyvpu" }, "margin": "lg", "style": "primary", "color": "#00B900" }
    ] }
  };
}

function broadcastFlexMessage(cardJson) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/broadcast', {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    method: 'post',
    payload: JSON.stringify({ messages: [{ type: "flex", altText: "冰箱管家提醒您", contents: cardJson }] })
  });
}

function fetchFromOpenFoodFacts(barcode) {
  try {
    const res = UrlFetchApp.fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());
    if (json.status === 1 && json.product) {
      const p = json.product;
      return p.product_name_zh || p.product_name || p.generic_name_zh || p.brands || null;
    }
  } catch (e) {}
  return null;
}

function lookupProduct(barcode) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(PRODUCT_DB_SHEET);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  const searchKey = String(barcode).trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === searchKey) return data[i][1];
  }
  return null;
}

function updateProductDb(barcode, name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(PRODUCT_DB_SHEET) || ss.insertSheet(PRODUCT_DB_SHEET);
  if (sheet.getLastRow() === 0) sheet.appendRow(["條碼", "品名"]);
  const data = sheet.getDataRange().getValues();
  if (!data.some(row => String(row[0]).trim() === String(barcode).trim())) {
    sheet.appendRow([barcode, name]);
  }
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
