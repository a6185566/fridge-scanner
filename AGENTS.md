# 專案操作手則 (Project Agent Guidelines)

## 1. 專案背景與定位
- **專案名稱**：冰箱管理員 (Fridge Manager) 系統與 Line Bot 串接專案。
- **核心架構**：以 Google Sheets 作為資料庫，透過 Google Apps Script (GAS) 撰寫後端 API 與 Line 官方帳號進行 Webhook 雙向串接，前端則使用託管於 GitHub 的 HTML 網頁。
- **單一事實來源 (SSOT)**：所有程式碼皆以本地專案資料夾內的檔案為準，禁止跳過本地環境直接去 Google 雲端修改 Apps Script。

## 2. 專案檔案結構規範
當你讀取或修改專案時，請認明以下主要檔案：
- `*.gs` 或 `*.js`：Google Apps Script 的後端邏輯（如 Line Webhook 處理、試算表讀寫）。
- `*.html`：前端介面網頁。
- `appsscript.json`：Google Apps Script 的專案資訊與權限設定檔（由 clasp 自動生成）。
- `.clasp.json`：clasp 工具的連接設定檔。

## 3. 程式碼修改原則
- **模組化與註解**：修改或新增程式碼時，必須保持程式碼乾淨，並在關鍵邏輯（尤其是 Line API 呼叫、JSON 格式解析、試算表欄位寫入）加上繁體中文註解。
- **安全性**：涉及 Line Channel Token、Google Sheet ID 等敏感資訊時，若原程式碼已抽離至環境變數或特定屬性（如 `PropertiesService`），請維持該架構，切勿將 Secret 直接寫死在 Code 中。

## 4. 自動化部署與同步 SOP (核心技能)
當使用者要求「修改並部署」或「同步」程式碼時，你必須**嚴格依序**在系統終端機執行以下步驟：

### 步驟一：本地修改
- 完成程式碼或 HTML 的編輯，並確實儲存檔案。

### 步驟二：同步至 GitHub
在本地終端機依序執行以下指令，將代碼推送至遠端儲存庫：
1. `git add .`
2. `git commit -m "feat(ai): [簡短描述你這次修改了什麼功能]"`
3. `git push`

### 步驟三：同步至 Google Apps Script 雲端
在本地終端機執行 `clasp` 指令，將更新直接覆蓋推送到 Google 雲端 Apps Script 環境：
1. `clasp push`

## 5. 工作回報規範
- 任務完成後，請明確列出：
  1. 你修改了哪些檔案的哪些核心邏輯。
  2. GitHub 是否已成功 Push。
  3. Clasp 是否已成功 Push 且無錯誤訊息。